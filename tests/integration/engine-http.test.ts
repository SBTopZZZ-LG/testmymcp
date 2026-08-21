import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TestLevel } from '../../src/core/types/test-result.js';
import { protocolAdapterFactory } from '../../src/core/protocol/factory.js';
import { defaultRunOptions } from '../../src/engine/options.js';
import { TestEngine } from '../../src/engine/engine.js';
import { StreamableHttpTransport, LegacySseTransport } from '../../src/transports/http/index.js';

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/http-server.js');

interface Fixture {
  port: number;
  kill(): Promise<void>;
}

function randomPort(): number {
  return 10000 + Math.floor(Math.random() * 40000);
}

async function startFixture(flags: string[] = []): Promise<Fixture> {
  const port = randomPort();
  const child = spawn(process.execPath, [fixturePath, '--port', String(port), ...flags], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await new Promise<void>((resolvePort, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`fixture startup timed out; stderr: ${stderr}`)), 10_000);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      const match = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(stderr);
      if (match !== null && match[1] !== undefined) {
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

async function runEngine(url: string, transportType: 'streamable-http' | 'legacy-sse') {
  const transport =
    transportType === 'legacy-sse'
      ? new LegacySseTransport({ url, requestTimeoutMs: 10_000 })
      : new StreamableHttpTransport({ url, protocolVersion: '2025-11-25', requestTimeoutMs: 10_000 });

  const runOptions = defaultRunOptions({
    mode: 'safe',
    maxLevel: TestLevel.Capability,
    defaultTimeoutMs: 15_000,
    requestTimeoutMs: 10_000,
  });

  const adapter = protocolAdapterFactory.create('legacy', {
    transport,
    requestTimeoutMs: 10_000,
    initTimeoutMs: 5000,
    shutdownTimeoutMs: 5000,
  });
  const engine = new TestEngine({ adapter, transport, options: runOptions });
  try {
    return { results: await engine.run(), shared: engine.shared, transport };
  } finally {
    await engine.dispose();
  }
}

describe('engine integration over streamable HTTP', () => {
  it('passes a well-behaved server and establishes a session', async () => {
    const fixture = await startFixture();
    try {
      const url = `http://127.0.0.1:${fixture.port}/`;
      const { results, shared, transport } = await runEngine(url, 'streamable-http');

      expect(results.some((r) => r.status === 'fail')).toBe(false);
      expect(results.map((r) => r.id)).toContain('protocol initialize');
      expect(shared.session?.protocolVersion).toBe('2025-11-25');
      expect(shared.tools.map((t) => t.name)).toEqual(['sum', 'delete_file']);
      expect(transport.sessionId).toBeDefined();
      expect((transport as StreamableHttpTransport).headerIssues).toHaveLength(0);
    } finally {
      await fixture.kill();
    }
  });

  it('surfaces an Mcp-Method routing mismatch when the server lies', async () => {
    const fixture = await startFixture(['--bad-method-header']);
    try {
      const url = `http://127.0.0.1:${fixture.port}/`;
      const transport = new StreamableHttpTransport({ url, protocolVersion: '2025-11-25', requestTimeoutMs: 10_000 });
      const adapter = protocolAdapterFactory.create('legacy', { transport, initTimeoutMs: 5000 });
      transport.observer = { onMessage: (message) => adapter.mux.handleMessage(message) };
      await adapter.connect();
      await adapter.initialize({ skipInitialized: true });
      const issues = transport.headerIssues;
      expect(issues.length).toBeGreaterThan(0);
      const methodIssue = issues.find((i) => i.header === 'Mcp-Method' && i.severity === 'error');
      expect(methodIssue).toBeDefined();
      expect(methodIssue?.actual).toBe('initialize-WRONG');
      await adapter.disconnect();
    } finally {
      await fixture.kill();
    }
  });
});

describe('engine integration over legacy SSE', () => {
  it('passes a well-behaved server and streams responses', async () => {
    const fixture = await startFixture();
    try {
      const url = `http://127.0.0.1:${fixture.port}/sse`;
      const { results, shared, transport } = await runEngine(url, 'legacy-sse');

      expect(results.some((r) => r.status === 'fail')).toBe(false);
      expect(results.map((r) => r.id)).toContain('protocol initialize');
      expect(shared.session?.protocolVersion).toBe('2025-11-25');
      expect(shared.tools.map((t) => t.name)).toEqual(['sum', 'delete_file']);
      expect((transport as LegacySseTransport).sessionId).toBeDefined();
    } finally {
      await fixture.kill();
    }
  });
});
