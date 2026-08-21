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

interface RunOutcome {
  results: TestResult[];
  shared: SharedDiscovery;
}

async function runCommand(
  flagArgs = '',
  options: Partial<RunOptions> = {},
  adapterInitTimeoutMs = 5000,
): Promise<RunOutcome> {
  const transport = new StdioTransport({
    command: `node "${fixturePath}" ${flagArgs}`.trim(),
    shutdownTimeoutMs: 5000,
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
});
