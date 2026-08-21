import { type ChildProcess, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { protocolAdapterFactory } from '../../src/core/protocol/factory.js';
import { TestLevel, type TestResult } from '../../src/core/types/test-result.js';
import type { SharedDiscovery } from '../../src/engine/ctx.js';
import { TestEngine } from '../../src/engine/engine.js';
import { type RunOptions, defaultRunOptions } from '../../src/engine/options.js';
import { StreamableHttpTransport } from '../../src/transports/http/index.js';
import { StdioTransport } from '../../src/transports/stdio/index.js';

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures');

export type ExpectedStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface ScenarioSetup {
  era: 'legacy' | 'modern';
  transport: 'stdio' | 'streamable-http';
  protocolVersion?: string;
  maxLineBytes?: number;
  options?: Partial<RunOptions>;
}

export interface ScenarioOutcome {
  results: TestResult[];
  shared: SharedDiscovery;
  transport?: StdioTransport | StreamableHttpTransport;
}

function randomPort(): number {
  return 10000 + Math.floor(Math.random() * 40000);
}

async function waitForListening(child: ChildProcess, timerMs: number): Promise<void> {
  return new Promise<void>((resolvePort, reject) => {
    let stderr = '';
    const timer = setTimeout(
      () => reject(new Error(`fixture startup timed out; stderr: ${stderr}`)),
      timerMs,
    );
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (/listening on /.test(stderr)) {
        clearTimeout(timer);
        resolvePort();
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`fixture exited early with code ${code}; stderr: ${stderr}`));
    });
  });
}

function killChild(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolveKill) => {
    if (child.exitCode !== null) return resolveKill();
    child.once('exit', () => resolveKill());
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).once(
        'exit',
        () => setTimeout(resolveKill, 100),
      );
    } else {
      child.kill('SIGTERM');
      setTimeout(resolveKill, 300);
    }
  });
}

function buildEngineSetup(
  setup: ScenarioSetup,
  transport: StdioTransport | StreamableHttpTransport,
) {
  const runOptions = defaultRunOptions({
    mode: 'safe',
    maxLevel: TestLevel.Robustness,
    defaultTimeoutMs: 15_000,
    requestTimeoutMs: 10_000,
    ...(setup.options ?? {}),
  });
  const reqTimeout = setup.options?.requestTimeoutMs ?? runOptions.requestTimeoutMs ?? 10_000;
  const adapter = protocolAdapterFactory.create(setup.era, {
    transport,
    requestTimeoutMs: reqTimeout,
    initTimeoutMs: setup.options?.connectTimeoutMs ?? 5000,
    shutdownTimeoutMs: 5000,
  });
  return { engine: new TestEngine({ adapter, transport, options: runOptions }) };
}

export async function runScenario(
  fixtureRel: string,
  setup: ScenarioSetup,
  flags: string[] = [],
): Promise<{ outcome: ScenarioOutcome; dispose(): Promise<void> }> {
  const full = resolve(fixturesDir, fixtureRel);

  if (setup.transport === 'stdio') {
    const transport = new StdioTransport({
      command: `node "${full}" ${flags.join(' ')}`.trim(),
      maxLineBytes: setup.maxLineBytes,
      shutdownTimeoutMs: 5000,
    });
    const { engine } = buildEngineSetup(setup, transport);
    const results = await engine.run();
    const shared = engine.shared;
    return {
      outcome: { results, shared, transport },
      dispose: () => engine.dispose(),
    };
  }

  // streamable-http: spawn the fixture process on a random port.
  const port = randomPort();
  const child = spawn(process.execPath, [full, '--port', String(port), ...flags], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await waitForListening(child, 10_000);
  const protocolVersion =
    setup.protocolVersion ?? (setup.era === 'modern' ? '2026-07-28' : '2025-11-25');
  const transport = new StreamableHttpTransport({
    url: `http://127.0.0.1:${port}/`,
    protocolVersion,
    era: setup.era,
    requestTimeoutMs: setup.options?.requestTimeoutMs ?? 10_000,
  });
  const { engine } = buildEngineSetup(setup, transport);
  const results = await engine.run();
  const shared = engine.shared;
  await engine.dispose();
  return {
    outcome: { results, shared, transport },
    dispose: () => killChild(child),
  };
}
