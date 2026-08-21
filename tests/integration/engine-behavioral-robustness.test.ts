import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TestLevel, type TestResult } from '../../src/core/types/test-result.js';
import { protocolAdapterFactory } from '../../src/core/protocol/factory.js';
import { defaultRunOptions } from '../../src/engine/options.js';
import { TestEngine } from '../../src/engine/engine.js';
import { StreamableHttpTransport } from '../../src/transports/http/index.js';
import { StdioTransport } from '../../src/transports/stdio/index.js';
import { followListPages } from '../../src/suites/pagination.js';
import { SUITES } from '../../src/suites/index.js';

const modernFixture = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/modern-server.js');
const httpFixture = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/http-server.js');
const stdioFixture = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/fake-server.js');

interface Fixture {
  port: number;
  kill(): Promise<void>;
}

function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 30000);
}

async function startHttpFixture(fixturePath: string, flags: string[] = []): Promise<Fixture> {
  const port = randomPort();
  const child = spawn(process.execPath, [fixturePath, '--port', String(port), ...flags], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await new Promise<void>((resolvePort, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`fixture startup timed out; stderr: ${stderr}`)), 10_000);
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
  return {
    port,
    kill: () =>
      new Promise<void>((resolveKill) => {
        if (child.exitCode !== null) return resolveKill();
        child.once('exit', () => resolveKill());
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).once('exit', () =>
            setTimeout(resolveKill, 100),
          );
        } else {
          child.kill('SIGTERM');
          setTimeout(resolveKill, 300);
        }
      }),
  };
}

describe('Phase 4: behavioral + robustness suites run cleanly at every level', () => {
  it('registers behavioral (level 4) and robustness (level 5) suites', () => {
    const names = SUITES.map((s) => s.name);
    expect(names).toContain('behavioral');
    expect(names).toContain('robustness');
  });

  it('modern (stateless HTTP): level Robustness run has 0 fails and runs the new suites', async () => {
    const fixture = await startHttpFixture(modernFixture);
    try {
      const url = `http://127.0.0.1:${fixture.port}/`;
      const transport = new StreamableHttpTransport({ url, protocolVersion: '2026-07-28', era: 'modern', requestTimeoutMs: 12_000 });
      const runOptions = defaultRunOptions({
        mode: 'safe',
        maxLevel: TestLevel.Robustness,
        defaultTimeoutMs: 20_000,
        requestTimeoutMs: 12_000,
      });
      const adapter = protocolAdapterFactory.create('modern', { transport, requestTimeoutMs: 12_000, initTimeoutMs: 5000 });
      const engine = new TestEngine({ adapter, transport, options: runOptions });
      let results: TestResult[] = [];
      try {
        results = await engine.run();
      } finally {
        await engine.dispose();
      }

      expect(results.some((r) => r.status === 'fail')).toBe(false);
      const ids = results.map((r) => r.id);
      expect(ids).toContain('behavioral concurrency parallel');
      expect(ids).toContain('behavioral payload huge');
      expect(ids).toContain('behavioral payload unicode');
      expect(ids).toContain('behavioral payload binary');
      expect(ids).toContain('behavioral concurrent mixed');
      expect(ids).toContain('robustness cancellation');
      expect(ids).toContain('robustness malformed-input');
      expect(ids).toContain('robustness error-recovery');
      expect(ids).toContain('robustness concurrency-stress');
    } finally {
      await fixture.kill();
    }
  }, 60000);

  it('legacy (stdio): level Robustness run has 0 fails and runs the new suites', async () => {
    const transport = new StdioTransport({ command: `node "${stdioFixture}"`.trim(), shutdownTimeoutMs: 5000 });
    const runOptions = defaultRunOptions({
      mode: 'safe',
      maxLevel: TestLevel.Robustness,
      defaultTimeoutMs: 20_000,
      requestTimeoutMs: 15_000,
    });
    const adapter = protocolAdapterFactory.create('legacy', { transport, requestTimeoutMs: 15_000, initTimeoutMs: 5000 });
    const engine = new TestEngine({ adapter, transport, options: runOptions });
    let results: TestResult[] = [];
    try {
      results = await engine.run();
    } finally {
      await engine.dispose();
    }

    expect(results.some((r) => r.status === 'fail')).toBe(false);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('behavioral concurrency parallel');
    expect(ids).toContain('behavioral payload huge');
    expect(ids).toContain('robustness cancellation');
    expect(ids).toContain('robustness concurrency-stress');
  }, 60000);

  it('legacy (streamable HTTP): level Robustness run has 0 fails', async () => {
    const fixture = await startHttpFixture(httpFixture);
    try {
      const url = `http://127.0.0.1:${fixture.port}/`;
      const transport = new StreamableHttpTransport({ url, protocolVersion: '2025-11-25', requestTimeoutMs: 12_000 });
      const runOptions = defaultRunOptions({
        mode: 'safe',
        maxLevel: TestLevel.Robustness,
        defaultTimeoutMs: 20_000,
        requestTimeoutMs: 12_000,
      });
      const adapter = protocolAdapterFactory.create('legacy', { transport, requestTimeoutMs: 12_000, initTimeoutMs: 5000 });
      const engine = new TestEngine({ adapter, transport, options: runOptions });
      let results: TestResult[] = [];
      try {
        results = await engine.run();
      } finally {
        await engine.dispose();
      }
      expect(results.some((r) => r.status === 'fail')).toBe(false);
    } finally {
      await fixture.kill();
    }
  }, 60000);
});

describe('Phase 4: cursor-based pagination is followed to exhaustion', () => {
  it('modern server aggregates all tools across pages via nextCursor', async () => {
    const fixture = await startHttpFixture(modernFixture, ['--paginate']);
    try {
      const url = `http://127.0.0.1:${fixture.port}/`;
      const transport = new StreamableHttpTransport({ url, protocolVersion: '2026-07-28', era: 'modern', requestTimeoutMs: 12_000 });
      const adapter = protocolAdapterFactory.create('modern', { transport, initTimeoutMs: 5000 });
      transport.observer = { onMessage: (message) => adapter.mux.handleMessage(message) };
      await adapter.connect();
      await adapter.initialize();

      const first = (await adapter.request('tools/list', undefined, 8000)) as Record<string, unknown>;
      expect(first.nextCursor).toBe('1');
      const followed = await followListPages(adapter, { method: 'tools/list', itemKey: 'tools' }, first, 8000, 10);
      const names = (followed.items as Array<Record<string, unknown>>).map((t) => t.name).sort();
      expect(names).toEqual(['big_echo', 'echo', 'slow', 'sum']);
      expect(followed.pages).toBe(4);
      expect(followed.truncated).toBe(false);

      await adapter.disconnect();
    } finally {
      await fixture.kill();
    }
  }, 30000);
});
