import { describe, expect, it } from 'vitest';

import {
  type JsonRpcId,
  createErrorResponse,
  createResponse,
} from '../../src/core/jsonrpc/messages.js';
import {
  type ModernAdapterOptions,
  createModernProtocolAdapter,
} from '../../src/protocols/modern/adapter.js';
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

function asParams(sent: unknown): Record<string, unknown> | undefined {
  return (sent as { params?: Record<string, unknown> }).params;
}

function discoverResult() {
  return {
    resultType: 'complete',
    supportedVersions: ['2026-07-28'],
    capabilities: { tools: { listChanged: true }, resources: {} },
    _meta: {
      'io.modelcontextprotocol/serverInfo': { name: 'fake-server', version: '1.0.0' },
    },
    ttlMs: 60000,
    cacheScope: 'public',
  };
}

function makeAdapter(transport: FakeTransport, extra: Partial<ModernAdapterOptions> = {}) {
  const adapter = createModernProtocolAdapter({
    transport,
    idStyle: 'number',
    requestTimeoutMs: 2000,
    discoverTimeoutMs: 2000,
    ...extra,
  });
  transport.observer = { onMessage: (message) => adapter.mux.handleMessage(message) };
  return adapter;
}

describe('ModernProtocolAdapter', () => {
  it('connects and performs server/discover instead of initialize', async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);

    await adapter.connect();
    expect(adapter.state).toBe('connected');

    const initPromise = adapter.initialize();
    const first = transport.sent[0];
    expect(asParams(first)?.['_meta']).toBeDefined();
    expect((first as { method: string }).method).toBe('server/discover');

    transport.observer?.onMessage?.(createResponse(asId(first), discoverResult()));
    const session = await initPromise;

    expect(session.protocolVersion).toBe('2026-07-28');
    expect(session.serverInfo.name).toBe('fake-server');
    expect(session.serverCapabilities.tools).toBe(true);
    expect(session.serverCapabilities.toolListChanged).toBe(true);
    expect(adapter.state).toBe('operational');
    // No notifications/initialized in modern.
    expect(
      transport.sent.some((m) => (m as { method?: string }).method === 'notifications/initialized'),
    ).toBe(false);
  });

  it('attaches required _meta fields to every request', async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    await adapter.connect();

    const p = adapter.request('tools/list', undefined, 2000);
    const sent = transport.sent[0] as { params?: { _meta?: Record<string, unknown> } };
    const meta = sent.params?._meta;
    expect(meta?.['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28');
    expect(meta?.['io.modelcontextprotocol/clientCapabilities']).toBeDefined();
    expect(meta?.['io.modelcontextprotocol/clientInfo']).toBeDefined();

    transport.observer?.onMessage?.(
      createResponse(asId(transport.sent[0]), {
        resultType: 'complete',
        tools: [],
        ttlMs: 1000,
        cacheScope: 'public',
      }),
    );
    await p;
  });

  it('throws remote errors with code for the spec error codes', async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    await adapter.connect();

    const p = adapter.request('server/discover', undefined, 2000);
    transport.observer?.onMessage?.(
      createErrorResponse(asId(transport.sent[0]), -32022, 'Unsupported protocol version', {
        supported: ['2026-07-28'],
        requested: '2099-01-01',
      }),
    );
    await expect(p).rejects.toMatchObject({ name: 'JsonRpcRemoteError', code: -32022 });
  });

  it('automatically retries on input_required MRTR results', async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    await adapter.connect();

    const p = adapter.request('tools/call', { name: 'ask', arguments: {} }, 2000);

    // First response: input_required with an elicitation + requestState.
    const firstId = asId(transport.sent[0]);
    transport.observer?.onMessage?.(
      createResponse(firstId, {
        resultType: 'input_required',
        inputRequests: {
          confirm: { method: 'elicitation/create', params: { mode: 'form', message: 'confirm' } },
        },
        requestState: 'state-1',
      }),
    );

    // Adapter should re-issue with inputResponses + requestState and a NEW id.
    await new Promise((r) => setTimeout(r, 10));
    const second = transport.sent[1];
    expect(second).toBeDefined();
    expect(asId(second)).not.toBe(firstId);
    const secondParams = asParams(second) as Record<string, unknown>;
    expect(secondParams.inputResponses).toBeDefined();
    expect(secondParams.requestState).toBe('state-1');

    transport.observer?.onMessage?.(
      createResponse(asId(second), {
        resultType: 'complete',
        content: [{ type: 'text', text: 'confirmed' }],
        evidence: secondParams.requestState,
      }),
    );
    const result = (await p) as Record<string, unknown>;
    expect(result.evidence).toBe('state-1');
  });

  it('shuts down without a notifications/shutdown and stops the transport', async () => {
    const transport = new FakeTransport();
    const adapter = makeAdapter(transport);
    await adapter.connect();

    const initPromise = adapter.initialize();
    transport.observer?.onMessage?.(createResponse(asId(transport.sent[0]), discoverResult()));
    await initPromise;

    await adapter.shutdown();
    expect(adapter.state).toBe('closed');
    expect(transport.stopped).toBe(true);
    expect(
      transport.sent.some((m) => (m as { method?: string }).method === 'notifications/shutdown'),
    ).toBe(false);
  });
});
