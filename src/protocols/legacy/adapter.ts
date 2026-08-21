import { type IdStyle, createIdGenerator } from '../../core/jsonrpc/id.js';
import {
  type JsonRpcId,
  createNotification,
  createRequest,
  responseKey,
} from '../../core/jsonrpc/messages.js';
import { JsonRpcRemoteError, RequestMultiplexer } from '../../core/jsonrpc/multiplexer.js';
import type {
  InitializeOptions,
  LifecycleState,
  NegotiatedSession,
  ProtocolAdapter,
  ServerInfo,
} from '../../core/protocol/adapter.js';
import type { ClientCapabilities } from '../../core/protocol/capabilities.js';
import { emptyClientCapabilities } from '../../core/protocol/capabilities.js';
import type { TimeoutKind } from '../../core/timeouts/deadline.js';
import type { TraceStore } from '../../core/tracing/store.js';
import type { ProtocolEra, ProtocolVersion } from '../../core/types/protocol.js';
import type { Transport } from '../../transports/transport.js';
import { buildInitializeParams, parseInitializeResult } from './initialize.js';

export interface LegacyAdapterOptions {
  transport: Transport;
  clientInfo?: ServerInfo;
  clientCapabilities?: Partial<ClientCapabilities>;
  preferVersion?: ProtocolVersion;
  requestTimeoutMs?: number;
  initTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  idStyle?: IdStyle;
  clock?: () => number;
  trace?: TraceStore;
}

const LEGACY_DEFAULT_VERSION: ProtocolVersion = '2025-11-25';
const DEFAULT_CLIENT_NAME = 'testmymcp';
const DEFAULT_CLIENT_VERSION = '0.1.0';

export class LegacyProtocolAdapter implements ProtocolAdapter {
  readonly era: ProtocolEra = 'legacy';
  readonly mux: RequestMultiplexer;
  private readonly transport: Transport;
  private readonly clientInfo: ServerInfo;
  private readonly clientCapabilities: ClientCapabilities;
  private readonly preferVersion: ProtocolVersion;
  private readonly requestTimeoutMs: number;
  private readonly initTimeoutMs: number;
  private readonly idGen: () => JsonRpcId;
  private readonly trace?: TraceStore;
  private readonly clock: () => number;
  private readonly startedAt: Map<string, number> = new Map();
  private lifecycleState: LifecycleState = 'created';
  private session: NegotiatedSession | undefined;

  constructor(options: LegacyAdapterOptions) {
    this.transport = options.transport;
    this.clientInfo = {
      name: options.clientInfo?.name ?? DEFAULT_CLIENT_NAME,
      version: options.clientInfo?.version ?? DEFAULT_CLIENT_VERSION,
    };
    this.clientCapabilities = { ...emptyClientCapabilities(), ...options.clientCapabilities };
    this.preferVersion = options.preferVersion ?? LEGACY_DEFAULT_VERSION;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.initTimeoutMs = options.initTimeoutMs ?? 15_000;
    this.idGen = createIdGenerator(options.idStyle ?? 'mixed');
    this.trace = options.trace;
    this.clock = options.clock ?? Date.now;
    this.mux = new RequestMultiplexer({ timeoutMs: this.requestTimeoutMs, clock: this.clock });
  }

  get state(): LifecycleState {
    return this.lifecycleState;
  }

  async connect(): Promise<void> {
    this.setState('connecting');
    await this.transport.start();
    this.setState('connected');
  }

  async initialize(options?: InitializeOptions): Promise<NegotiatedSession> {
    if (this.state === 'created' || this.state === 'failed') {
      throw new Error(`cannot initialize from state "${this.state}"`);
    }
    this.setState('initializing');
    const params = buildInitializeParams({
      protocolVersion: this.preferVersion,
      clientInfo: this.clientInfo,
      clientCapabilities: this.clientCapabilities,
    });
    const result = await this.rawRequest(
      this.idGen(),
      'initialize',
      params,
      this.initTimeoutMs,
      'initialize',
    );
    const parsed = parseInitializeResult(result);
    this.session = {
      protocolVersion: parsed.protocolVersion,
      negotiated: parsed.protocolVersion !== this.preferVersion,
      claimedVersion: this.preferVersion,
      serverInfo: parsed.serverInfo,
      clientInfo: this.clientInfo,
      serverCapabilities: parsed.serverCapabilities,
    };
    if (options?.skipInitialized !== true) {
      await this.notify('notifications/initialized');
    }
    this.setState('operational');
    return this.session;
  }

  request<T = unknown>(method: string, params?: object, timeoutMs?: number): Promise<T> {
    const kind: TimeoutKind = method.startsWith('tools/') ? 'tool' : 'request';
    return this.rawRequest<T>(this.idGen(), method, params, timeoutMs, kind);
  }

  async rawRequest<T = unknown>(
    id: JsonRpcId,
    method: string,
    params?: object,
    timeoutMs?: number,
    timeoutKind: TimeoutKind = 'request',
  ): Promise<T> {
    const request = createRequest(id, method, params);
    this.traceOut(request);
    const registered = this.mux.register(request, timeoutMs, timeoutKind);
    try {
      await this.send(request);
    } catch (error) {
      this.mux.failById(request.id, error instanceof Error ? error : new Error(String(error)));
      await registered.catch(() => {});
      throw error;
    }
    const response = await registered;
    this.traceIn(response, request.id);
    if (response.error !== undefined) {
      throw new JsonRpcRemoteError(
        response.error.code,
        response.error.message,
        response.error.data,
      );
    }
    return response.result as T;
  }

  notify(method: string, params?: object): Promise<void> {
    const notification = createNotification(method, params);
    this.traceOut(notification);
    return this.send(notification);
  }

  async shutdown(): Promise<void> {
    if (this.state === 'operational') {
      this.setState('shutting-down');
      try {
        await this.send(createNotification('notifications/shutdown'));
      } catch {
        // transport may already be gone; ignore
      }
    }
    await this.transport.stop();
    this.setState('closed');
  }

  async disconnect(): Promise<void> {
    await this.transport.stop();
    if (this.state !== 'closed') this.setState('closed');
  }

  private setState(next: LifecycleState): void {
    this.lifecycleState = next;
  }

  private send(message: object): Promise<void> {
    return this.transport.send(message);
  }

  private traceOut(message: object): void {
    if (this.trace === undefined) return;
    const record = message as Record<string, unknown>;
    const key =
      typeof record.id === 'number' || typeof record.id === 'string'
        ? responseKey(record.id)
        : undefined;
    const now = this.clock();
    if (key !== undefined) this.startedAt.set(key, now);
    this.trace.add({
      direction: 'out',
      kind: 'id' in record && key !== undefined ? 'request' : 'notification',
      transport: this.transport.kind,
      method: typeof record.method === 'string' ? record.method : undefined,
      requestId: key !== undefined ? (record.id as JsonRpcId) : undefined,
      payload: record.params ?? message,
      timestamp: now,
    });
  }

  private traceIn(
    response: { id: JsonRpcId; error?: { code: number; message: string } | undefined },
    requestId: JsonRpcId,
  ): void {
    if (this.trace === undefined) return;
    const key = responseKey(requestId);
    const started = this.startedAt.get(key);
    this.startedAt.delete(key);
    this.trace.add({
      direction: 'in',
      kind: 'response',
      transport: this.transport.kind,
      requestId,
      latencyMs: started !== undefined ? this.clock() - started : undefined,
      status: response.error !== undefined ? `error ${response.error.code}` : 'ok',
      timestamp: this.clock(),
    });
  }
}

export function createLegacyProtocolAdapter(options: LegacyAdapterOptions): LegacyProtocolAdapter {
  return new LegacyProtocolAdapter(options);
}
