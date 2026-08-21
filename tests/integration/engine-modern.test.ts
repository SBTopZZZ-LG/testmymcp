import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TestLevel } from '../../src/core/types/test-result.js';
import { protocolAdapterFactory } from '../../src/core/protocol/factory.js';
import { defaultRunOptions } from '../../src/engine/options.js';
import { TestEngine } from '../../src/engine/engine.js';
import { StreamableHttpTransport } from '../../src/transports/http/index.js';

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/modern-server.js');

interface Fixture {
  port: number;
  kill(): Promise<void>;
}

function randomPort(): number {
  return 51000 + Math.floor(Math.random() * 2000);
}

async function startFixture(flags: string[] = []): Promise<Fixture> {
  const port = randomPort();
  const child = spawn(process.execPath, [fixturePath, '--port', String(port), ...flags], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await new Promise<void>((resolvePort, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`modern fixture startup timed out; stderr: ${stderr}`)), 10_000);
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
      reject(new Error(`modern fixture exited early with code ${code}; stderr: ${stderr}`));
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

describe('modern engine integration over streamable HTTP', () => {
  it('passes a well-behaved modern (stateless) server', async () => {
    const fixture = await startFixture();
    try {
      const url = `http://127.0.0.1:${fixture.port}/`;
      const runOptions = defaultRunOptions({
        mode: 'safe',
        maxLevel: TestLevel.Capability,
        defaultTimeoutMs: 15_000,
        requestTimeoutMs: 10_000,
      });
      const transport = new StreamableHttpTransport({
        url,
        protocolVersion: '2026-07-28',
        era: 'modern',
        requestTimeoutMs: 10_000,
      });
      const adapter = protocolAdapterFactory.create('modern', {
        transport,
        requestTimeoutMs: 10_000,
        initTimeoutMs: 5000,
        shutdownTimeoutMs: 5000,
      });
      transport.observer = { onMessage: (message) => adapter.mux.handleMessage(message) };
      const engine = new TestEngine({ adapter, transport, options: runOptions });

      let results;
      try {
        results = await engine.run();
      } finally {
        await engine.dispose();
      }

      expect(results.some((r) => r.status === 'fail')).toBe(false);
      expect(results.map((r) => r.id)).toContain('protocol discover');
      expect(engine.shared.session?.protocolVersion).toBe('2026-07-28');
      expect(engine.shared.tools.map((t) => t.name).sort()).toEqual(['big_echo', 'echo', 'slow', 'sum']);
      // Modern is stateless: no session id.
      expect(transport.sessionId).toBeUndefined();
    } finally {
      await fixture.kill();
    }
  });

  it('auto-completes an MRTR input_required tool call', async () => {
    const fixture = await startFixture();
    try {
      const url = `http://127.0.0.1:${fixture.port}/`;
      const transport = new StreamableHttpTransport({ url, protocolVersion: '2026-07-28', era: 'modern', requestTimeoutMs: 10_000 });
      const adapter = protocolAdapterFactory.create('modern', { transport, initTimeoutMs: 5000 });
      transport.observer = { onMessage: (message) => adapter.mux.handleMessage(message) };
      await adapter.connect();
      await adapter.initialize();

      const result = (await adapter.request('tools/call', { name: 'ask', arguments: {} }, 8000)) as Record<string, unknown>;
      expect(result.resultType).toBe('complete');
      expect(result.content).toBeDefined();
      await adapter.disconnect();
    } finally {
      await fixture.kill();
    }
  });

  it('surfaces UnsupportedProtocolVersionError when the version is rejected', async () => {
    const fixture = await startFixture(['--unsupported-version']);
    try {
      const url = `http://127.0.0.1:${fixture.port}/`;
      const transport = new StreamableHttpTransport({ url, protocolVersion: '2026-07-28', era: 'modern', requestTimeoutMs: 10_000 });
      const adapter = protocolAdapterFactory.create('modern', { transport, initTimeoutMs: 5000, preferVersion: '2026-07-28' });
      transport.observer = { onMessage: (message) => adapter.mux.handleMessage(message) };
      await adapter.connect();
      await expect(adapter.initialize()).rejects.toMatchObject({ code: -32022 });
      await adapter.disconnect();
    } finally {
      await fixture.kill();
    }
  });

  it('surfaces MissingRequiredClientCapabilityError (-32021) when a capability is required', async () => {
    const fixture = await startFixture(['--require-capability']);
    try {
      const url = `http://127.0.0.1:${fixture.port}/`;
      const transport = new StreamableHttpTransport({ url, protocolVersion: '2026-07-28', era: 'modern', requestTimeoutMs: 10_000 });
      const adapter = protocolAdapterFactory.create('modern', { transport, initTimeoutMs: 5000, preferVersion: '2026-07-28' });
      transport.observer = { onMessage: (message) => adapter.mux.handleMessage(message) };
      await adapter.connect();
      // discovery is exempt; the server enforces the capability on subsequent methods.
      await adapter.initialize();
      await expect(adapter.request('tools/list', undefined, 5000)).rejects.toMatchObject({ code: -32021 });
      await adapter.disconnect();
    } finally {
      await fixture.kill();
    }
  });

  it('opens a subscriptions/listen stream and receives change notifications', async () => {
    const fixture = await startFixture();
    try {
      const url = `http://127.0.0.1:${fixture.port}/`;
      const transport = new StreamableHttpTransport({ url, protocolVersion: '2026-07-28', era: 'modern', requestTimeoutMs: 10_000 });
      const adapter = protocolAdapterFactory.create('modern', { transport, initTimeoutMs: 5000 });
      transport.observer = { onMessage: (message) => adapter.mux.handleMessage(message) };
      await adapter.connect();
      await adapter.initialize();

      const sub = adapter.subscribe({ toolsListChanged: true });
      expect(sub.id).toBeDefined();

      // Wait for the ack + push notifications (fixture pushes every 200ms).
      await new Promise((resolve) => setTimeout(resolve, 700));
      const notifications = sub.notifications;
      expect(notifications.some((n) => n.method === 'notifications/subscriptions/acknowledged')).toBe(true);
      expect(notifications.some((n) => n.method === 'notifications/tools/list_changed')).toBe(true);
      expect(notifications.some((n) => n.method === 'notifications/resources/list_changed')).toBe(true);

      await sub.cancel();
      await adapter.disconnect();
    } finally {
      await fixture.kill();
    }
  });

  it('mirrors x-mcp-header tool parameters into Mcp-Param-* request headers', async () => {
    const fixture = await startFixture();
    try {
      const url = `http://127.0.0.1:${fixture.port}/`;
      const transport = new StreamableHttpTransport({ url, protocolVersion: '2026-07-28', era: 'modern', requestTimeoutMs: 10_000 });
      const adapter = protocolAdapterFactory.create('modern', { transport, initTimeoutMs: 5000 });
      transport.observer = { onMessage: (message) => adapter.mux.handleMessage(message) };
      await adapter.connect();
      await adapter.initialize();

      // Register the discovered tool schema so the transport can mirror headers.
      transport.setToolInputSchemas([
        {
          name: 'echo',
          inputSchema: {
            type: 'object',
            properties: {
              region: { type: 'string', 'x-mcp-header': 'Region' },
              count: { type: 'integer', 'x-mcp-header': 'Count' },
              note: { type: 'string', 'x-mcp-header': 'X-Note' },
              rate: { type: 'number' },
            },
          },
        },
      ]);

      const result = (await adapter.request(
        'tools/call',
        { name: 'echo', arguments: { region: 'us-east-1', count: 3, note: 'hello', rate: 0.5 } },
        8000,
      )) as Record<string, unknown>;
      expect(result.resultType).toBe('complete');
      const content = (result.content as Array<Record<string, unknown>>) ?? [];
      const headerLine = content.find((c) => typeof c.text === 'string' && c.text.startsWith('headers='))?.text ?? '';
      // The server echoes the Mcp-Param-* headers it observed (lowercased keys).
      expect(headerLine).toContain('mcp-param-region');
      expect(headerLine).toContain('mcp-param-count');
      expect(headerLine).toContain('mcp-param-x-note');
      // Non-annotated parameters must not be mirrored.
      expect(headerLine).not.toContain('mcp-param-rate');

      await adapter.disconnect();
    } finally {
      await fixture.kill();
    }
  });

  it('follows a Tasks extension task to completion', async () => {
    const fixture = await startFixture();
    try {
      const url = `http://127.0.0.1:${fixture.port}/`;
      const transport = new StreamableHttpTransport({ url, protocolVersion: '2026-07-28', era: 'modern', requestTimeoutMs: 10_000 });
      const adapter = protocolAdapterFactory.create('modern', { transport, initTimeoutMs: 5000 });
      transport.observer = { onMessage: (message) => adapter.mux.handleMessage(message) };
      await adapter.connect();
      await adapter.initialize();

      const created = (await adapter.request('tools/call', { name: 'slow', arguments: { label: 'hi' } }, 8000)) as Record<string, unknown>;
      expect(created.resultType).toBe('task');
      const taskId = typeof created.taskId === 'string' ? created.taskId : '';
      expect(taskId).not.toBe('');

      const final = (await adapter.pollTask(taskId, { maxPollMs: 8000 })) as Record<string, unknown>;
      expect(final.status).toBe('completed');
      expect(Array.isArray(final.content)).toBe(true);

      await adapter.disconnect();
    } finally {
      await fixture.kill();
    }
  }, 20000);
});
