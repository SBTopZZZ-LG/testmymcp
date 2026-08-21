import { describe, expect, it } from 'vitest';

import {
  type JsonRpcId,
  createErrorResponse,
  createResponse,
} from '../../src/core/jsonrpc/messages.js';
import {
  type LegacyAdapterOptions,
  createLegacyProtocolAdapter,
} from '../../src/protocols/legacy/adapter.js';
import type { ExitInfo, Transport, TransportObserver } from '../../src/transports/transport.js';

class FakeTransport implements Transport {
  kind = 'stdio' as const;
  observer?: TransportObserver;
  stderrLines: string[] = [];
  exited: ExitInfo | null = null;
  sent: unknown[] = [];
  started = false;
  stopped = false;

  async start(): Promise<void> {
    this.started = true;
  }

  async send(message: unknown): Promise<void> {
    this.sent.push(message);
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  isOpen(): boolean {
    return this.started && !this.stopped;
  }
}

function asId(sent: unknown): JsonRpcId {
  return (sent as { id: JsonRpcId }).id;
}

function asMethod(sent: unknown): string | undefined {
  return (sent as { method?: string }).method;
}

function initializeResult() {
  return {
    protocolVersion: '2025-11-25',
    serverInfo: { name: 'fake-server', version: '1.0.0' },
    capabilities: { tools: {} },
  };
}

function makeAdapter(transport: FakeTransport, extra: Partial<LegacyAdapterOptions> = {}) {
  const adapter = createLegacyProtocolAdapter({
    transport,
    idStyle: 'number',
    requestTimeoutMs: 2000,
    initTimeoutMs: 2000,
    ...extra,
  });
  transport.observer = { onMessage: (message) => adapter.mux.handleMessage(message) };
  return adapter;
}

describe('LegacyProtocolAdapter', () => {
  it('connects and performs the initialize handshake', async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);

    await adapter.connect();
    expect(adapter.state).toBe('connected');
    expect(transport.started).toBe(true);

    const initPromise = adapter.initialize();
    const first = transport.sent[0];
    expect(first).not.toBeUndefined();
    expect(asMethod(first)).toBe('initialize');

    transport.observer?.onMessage?.(createResponse(asId(first), initializeResult()));
    const session = await initPromise;

    expect(session.protocolVersion).toBe('2025-11-25');
    expect(session.serverInfo.name).toBe('fake-server');
    expect(session.serverCapabilities.tools).toBe(true);
    expect(adapter.state).toBe('operational');
    expect(asMethod(transport.sent[1])).toBe('notifications/initialized');
  });

  it('performs raw requests with explicit ids and throws remote errors', async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    await adapter.connect();

    const good = adapter.rawRequest('x1', 'ping', undefined, 2000);
    expect(asId(transport.sent[0])).toBe('x1');
    transport.observer?.onMessage?.(createResponse('x1', { ok: true }));
    await expect(good).resolves.toEqual({ ok: true });

    const bad = adapter.rawRequest('x2', 'ping', undefined, 2000);
    transport.observer?.onMessage?.(createErrorResponse('x2', -32601, 'nope'));
    await expect(bad).rejects.toMatchObject({ name: 'JsonRpcRemoteError', code: -32601 });
  });

  it('ignores responses for unknown ids', async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    await adapter.connect();
    expect(() => transport.observer?.onMessage?.(createResponse(9999, 'ghost'))).not.toThrow();
  });

  it('times out with the injected timeout kind when the server never responds', async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport, { initTimeoutMs: 50, requestTimeoutMs: 1000 });
    await adapter.connect();
    await expect(adapter.initialize()).rejects.toMatchObject({
      name: 'TimeoutError',
      kind: 'initialize',
      timeoutMs: 50,
    });
  });

  it('issues a shutdown notification and closes the transport', async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    await adapter.connect();

    const initPromise = adapter.initialize();
    transport.observer?.onMessage?.(createResponse(asId(transport.sent[0]), initializeResult()));
    await initPromise;

    await adapter.shutdown();
    expect(adapter.state).toBe('closed');
    expect(transport.stopped).toBe(true);
    expect(asMethod(transport.sent.at(-1))).toBe('notifications/shutdown');
  });

  it('returns request results and observes response ordering independence', async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    await adapter.connect();

    const p1 = adapter.rawRequest(1, 'ping', undefined, 2000);
    const p2 = adapter.rawRequest(2, 'ping', undefined, 2000);
    transport.observer?.onMessage?.(createResponse(2, 'second'));
    transport.observer?.onMessage?.(createResponse(1, 'first'));
    await expect(p2).resolves.toEqual('second');
    await expect(p1).resolves.toEqual('first');
  });

  it('rejects duplicate pending ids', async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    await adapter.connect();
    const first = adapter.rawRequest(5, 'ping', undefined, 0);
    await expect(adapter.rawRequest(5, 'ping', undefined, 0)).rejects.toThrow('already pending');
    transport.observer?.onMessage?.(createResponse(5, 'ok'));
    await expect(first).resolves.toEqual('ok');
  });
});
