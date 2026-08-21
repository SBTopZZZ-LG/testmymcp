import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { protocolAdapterFactory } from '../../src/core/protocol/factory.js';
import { TestLevel, type TestResult } from '../../src/core/types/test-result.js';
import type { SharedDiscovery } from '../../src/engine/ctx.js';
import { TestEngine } from '../../src/engine/engine.js';
import { type RunOptions, defaultRunOptions } from '../../src/engine/options.js';
import { StdioTransport } from '../../src/transports/stdio/index.js';

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/fake-server.js');
const bigResultFixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/unhappy/big-tool-result.js',
);

interface RunOutcome {
  results: TestResult[];
  shared: SharedDiscovery;
}

async function runEngine(
  command: string,
  options: Partial<RunOptions> = {},
  adapterInitTimeoutMs = 5000,
  maxLineBytes?: number,
): Promise<RunOutcome> {
  const transport = new StdioTransport({
    command,
    shutdownTimeoutMs: 5000,
    maxLineBytes,
  });
  const runOptions = defaultRunOptions({
    mode: 'safe',
    maxLevel: TestLevel.Capability,
    defaultTimeoutMs: 15000,
    requestTimeoutMs: 15000,
    ...options,
  });
  const adapter = protocolAdapterFactory.create('legacy', {
    transport,
    requestTimeoutMs: runOptions.requestTimeoutMs ?? 15000,
    initTimeoutMs: adapterInitTimeoutMs,
    shutdownTimeoutMs: 5000,
  });
  const engine = new TestEngine({ adapter, transport, options: runOptions });
  try {
    const results = await engine.run();
    return { results, shared: engine.shared };
  } finally {
    await engine.dispose();
  }
}

async function runCommand(
  flagArgs = '',
  options: Partial<RunOptions> = {},
  adapterInitTimeoutMs = 5000,
  maxLineBytes?: number,
): Promise<RunOutcome> {
  return runEngine(
    `node "${fixturePath}" ${flagArgs}`.trim(),
    options,
    adapterInitTimeoutMs,
    maxLineBytes,
  );
}

function ids(results: TestResult[]): string[] {
  return results.map((result) => result.id);
}

function byId(results: TestResult[], id: string): TestResult | undefined {
  return results.find((result) => result.id === id);
}

describe('engine integration over a real stdio process', () => {
  it('passes a well-behaved server across every level', async () => {
    const { results, shared } = await runCommand();

    expect(results.some((result) => result.status === 'fail')).toBe(false);
    expect(ids(results)).toContain('connect spawn');
    expect(ids(results)).toContain('connect stdout-clean');
    expect(ids(results)).toContain('protocol initialize');
    expect(ids(results)).toContain('tools/list');
    expect(ids(results)).toContain('resources/list');
    expect(ids(results)).toContain('prompts/list');
    expect(byId(results, 'tools/call sum')?.status).toBe('pass');
    expect(byId(results, 'tools/call delete_file')?.status).toBe('skip');

    expect(shared.session?.protocolVersion).toBe('2025-11-25');
    expect(shared.tools.map((tool) => tool.name)).toEqual(['sum', 'delete_file']);
  });

  it('flags garbage on stdout as a transport framing failure', async () => {
    const { results } = await runCommand('--banner');
    const framing = byId(results, 'protocol stdout-framing');
    expect(framing).toBeDefined();
    expect(framing?.status).toBe('fail');
    expect(framing?.error?.layer).toBe('transport');
    expect(framing?.error?.message).toMatch(/not valid JSON-RPC/);
  });

  it('detects a server that crashes on startup', async () => {
    const { results, shared } = await runCommand('--crash');
    // The crash can surface at connect (spawn fails in the settle window) or
    // at initialize (the child exits after connect resolves); either is a
    // correct detection. The invariant is that no session is established and
    // the premature exit is reported as a failure.
    expect(shared.session).toBeUndefined();
    const candidates = [
      byId(results, 'connect spawn'),
      byId(results, 'protocol initialize'),
      byId(results, 'engine connect'),
    ];
    expect(candidates.some((result) => result?.status === 'fail')).toBe(true);
  });

  it('times out against a server that never responds', async () => {
    const { results } = await runCommand('--hang', { connectTimeoutMs: 3000 }, 800);
    const initialize = byId(results, 'protocol initialize');
    expect(initialize).toBeDefined();
    expect(initialize?.status).toBe('fail');
  });

  it('invokes destructive tools when the mode allows it', async () => {
    const { results } = await runCommand('', { mode: 'all' });
    expect(byId(results, 'tools/call delete_file')?.status).toBe('pass');
  });

  it('fails a tool fast with a byte-level transport error when its result exceeds the line cap', async () => {
    // 1 MiB cap, but the get_symbols result is ~6 MB serialized. Before the
    // fix the oversized line was silently dropped and the call hung until the
    // overall timeout discarded every result (0 pass, "engine overall-timeout"
    // only). Now it must fail per-test and keep testing.
    const { results } = await runEngine(
      `node "${bigResultFixturePath}"`,
      { mode: 'all', defaultTimeoutMs: 20000, requestTimeoutMs: 20000 },
      5000,
      1024 * 1024,
    );

    expect(byId(results, 'engine overall-timeout')).toBeUndefined();
    const call = byId(results, 'tools/call get_symbols');
    expect(call).toBeDefined();
    expect(call?.status).toBe('fail');
    expect(call?.error?.layer).toBe('transport');
    expect(call?.error?.message).toMatch(/line-size limit \(\d+ bytes\)/);
    // Testing continued past the oversized call: connectivity results remain.
    expect(byId(results, 'connect spawn')?.status).toBe('pass');
  });

  it('passes a large tool result under the default (16 MiB) line cap', async () => {
    const { results } = await runEngine(
      `node "${bigResultFixturePath}"`,
      { mode: 'all' },
      5000,
      undefined,
    );

    expect(byId(results, 'engine overall-timeout')).toBeUndefined();
    expect(byId(results, 'tools/call get_symbols')?.status).toBe('pass');
  });

  it('preserves already-collected results when the overall deadline fires', async () => {
    // The hang fixture never responds, and requestTimeoutMs exceeds the overall
    // budget, so the engine must time out globally — but keep the connectivity
    // results it collected before the hang instead of returning only
    // "engine overall-timeout".
    const { results } = await runCommand('--hang', {
      defaultTimeoutMs: 800,
      requestTimeoutMs: 30000,
      connectTimeoutMs: 3000,
    });
    expect(byId(results, 'engine overall-timeout')).toBeDefined();
    expect(results.length).toBeGreaterThan(1);
    expect(byId(results, 'connect spawn')?.status).toBe('pass');
  });
});
