import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { protocolAdapterFactory } from '../../src/core/protocol/factory.js';
import { StreamableHttpTransport } from '../../src/transports/http/index.js';
import { StdioTransport } from '../../src/transports/stdio/index.js';

const modernFixture = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/modern-server.js',
);
const stdioFixture = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/fake-server.js');

function randomPort(): number {
  return 44000 + Math.floor(Math.random() * 3000);
}

describe('Phase 4: graceful shutdown', () => {
  it('StdioTransport gracefully terminates a cooperative server with a clean exit (code 0)', async () => {
    const transport = new StdioTransport({
      command: `node "${stdioFixture}"`.trim(),
      shutdownTimeoutMs: 5000,
    });
    const adapter = protocolAdapterFactory.create('legacy', {
      transport,
      requestTimeoutMs: 10_000,
      initTimeoutMs: 5000,
    });
    transport.observer = { onMessage: (message) => adapter.mux.handleMessage(message) };
    await adapter.connect();
    await adapter.initialize();
    await adapter.request('tools/call', { name: 'sum', arguments: { a: 1, b: 2 } }, 8000);

    // The transport ends stdin, waits for a clean exit, and only escalates to
    // SIGTERM/SIGKILL if the server does not exit on its own.
    await transport.stop();
    expect(transport.exited).not.toBeNull();
    expect(transport.exited?.code).toBe(0);
  }, 30000);

  it('the client disconnect resolves cleanly after the server is killed mid-session', async () => {
    const port = randomPort();
    const child = spawn(process.execPath, [modernFixture, '--port', String(port)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    await new Promise<void>((resolvePort, reject) => {
      let stderr = '';
      const timer = setTimeout(() => reject(new Error('startup timeout')), 10_000);
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        if (/listening on /.test(stderr)) {
          clearTimeout(timer);
          resolvePort();
        }
      });
    });
    try {
      const url = `http://127.0.0.1:${port}/`;
      const transport = new StreamableHttpTransport({
        url,
        protocolVersion: '2026-07-28',
        era: 'modern',
        requestTimeoutMs: 8000,
      });
      const adapter = protocolAdapterFactory.create('modern', {
        transport,
        initTimeoutMs: 5000,
        shutdownTimeoutMs: 3000,
      });
      transport.observer = { onMessage: (message) => adapter.mux.handleMessage(message) };
      await adapter.connect();
      await adapter.initialize();

      // Kill the server out from under the client.
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }

      // Disconnect must resolve (not hang) and must not throw.
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    } finally {
      if (process.platform !== 'win32') child.kill('SIGKILL');
    }
  }, 30000);
});

describe('Phase 4: client feature — server logging notifications are captured', () => {
  it('observes a logging/message notification emitted during a tool call', async () => {
    const transport = new StdioTransport({
      command: `node "${stdioFixture}" --log-on-call`.trim(),
      shutdownTimeoutMs: 5000,
    });
    const adapter = protocolAdapterFactory.create('legacy', {
      transport,
      requestTimeoutMs: 10_000,
      initTimeoutMs: 5000,
    });

    const logs: Array<Record<string, unknown>> = [];
    transport.observer = {
      onMessage: (message) => {
        adapter.mux.handleMessage(message);
        if (
          typeof message === 'object' &&
          message !== null &&
          (message as Record<string, unknown>)['method'] === 'notifications/logging/message'
        ) {
          logs.push(message as Record<string, unknown>);
        }
      },
    };

    await adapter.connect();
    await adapter.initialize();
    const result = (await adapter.request(
      'tools/call',
      { name: 'sum', arguments: { a: 1, b: 2 } },
      8000,
    )) as Record<string, unknown>;
    expect(result.content).toBeDefined();

    expect(logs.length).toBeGreaterThan(0);
    const log = logs[0] as { params?: { level?: string; data?: string } };
    expect(log.params?.level).toBe('info');
    expect(log.params?.data).toContain('sum called');

    await adapter.disconnect();
  }, 30000);
});
