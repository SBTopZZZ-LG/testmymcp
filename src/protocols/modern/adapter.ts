import type { ClientCapabilities } from '../../core/protocol/capabilities.js';
import { emptyClientCapabilities } from '../../core/protocol/capabilities.js';
import type {
  InitializeOptions,
  LifecycleState,
  NegotiatedSession,
  ProtocolAdapter,
  ServerInfo,
} from '../../core/protocol/adapter.js';
import type { ProtocolEra, ProtocolVersion } from '../../core/types/protocol.js';
import { createNotification, createRequest, responseKey, type JsonRpcId } from '../../core/jsonrpc/messages.js';
import { createIdGenerator, type IdStyle } from '../../core/jsonrpc/id.js';
import { JsonRpcRemoteError, RequestMultiplexer } from '../../core/jsonrpc/multiplexer.js';
import type { TimeoutKind } from '../../core/timeouts/deadline.js';
import type { TraceStore } from '../../core/tracing/store.js';
import type { Transport } from '../../transports/transport.js';
import { parseDiscoverResult, selectSupportedVersion, type DiscoverResult } from './discover.js';
import { withRequestMeta, type ModernRequestMeta } from './request-meta.js';
import { isInputRequiredResult, parseInputRequests, parseRequestState, buildInputRetryParams, buildInputResponse, type InputResponses } from './mrtr.js';


export interface ModernAdapterOptions {
  transport: Transport;
  clientInfo?: ServerInfo;
  clientCapabilities?: Partial<ClientCapabilities>;
  preferVersion?: ProtocolVersion;
  extensions?: Record<string, unknown>;
  requestTimeoutMs?: number;
  discoverTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  idStyle?: IdStyle;
  clock?: () => number;
  trace?: TraceStore;
  /** Whether request()/rawRequest() should automatically retry on `input_required` MRTR. */
  autoMrtr?: boolean;
}

const MODERN_DEFAULT_VERSION: ProtocolVersion = '2026-07-28';
const DEFAULT_CLIENT_NAME = 'testmymcp';
const DEFAULT_CLIENT_VERSION = '0.1.0';

export class ModernProtocolAdapter implements ProtocolAdapter {
  readonly era: ProtocolEra = 'modern';
  readonly mux: RequestMultiplexer;
  private readonly transport: Transport;
  private readonly clientInfo: ServerInfo;
  private readonly clientCapabilities: ClientCapabilities;
  private readonly preferVersion: ProtocolVersion;
  private readonly requestTimeoutMs: number;
  private readonly discoverTimeoutMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly idGen: () => JsonRpcId;
  private readonly trace?: TraceStore;
  private readonly clock: () => number;
  private readonly startedAt: Map<string, number> = new Map();
  private readonly autoMrtr: boolean;
  private lifecycleState: LifecycleState = 'created';
  private session: NegotiatedSession | undefined;
  private discovered: DiscoverResult | undefined;

  constructor(options: ModernAdapterOptions) {
    this.transport = options.transport;
    this.clientInfo = {
      name: options.clientInfo?.name ?? DEFAULT_CLIENT_NAME,
      version: options.clientInfo?.version ?? DEFAULT_CLIENT_VERSION,
    };
    this.clientCapabilities = { ...emptyClientCapabilities(), ...options.clientCapabilities };
    if (options.extensions !== undefined) {
      this.clientCapabilities.extensions = options.extensions;
    }
    this.preferVersion = options.preferVersion ?? MODERN_DEFAULT_VERSION;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.discoverTimeoutMs = options.discoverTimeoutMs ?? 15_000;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
    this.idGen = createIdGenerator(options.idStyle ?? 'mixed');
    this.trace = options.trace;
    this.clock = options.clock ?? Date.now;
    this.autoMrtr = options.autoMrtr ?? true;
    this.mux = new RequestMultiplexer({ timeoutMs: this.requestTimeoutMs, clock: this.clock });
  }

  get state(): LifecycleState {
    return this.lifecycleState;
  }

  get discoverResult(): DiscoverResult | undefined {
    return this.discovered;
  }

  async connect(): Promise<void> {
    this.setState('connecting');
    await this.transport.start();
    this.setState('connected');
  }

  /**
   * Modern protocol has no `initialize` handshake. This performs the optional
   * `server/discover` RPC to populate the session (supported versions,
   * capabilities, identity). It is safe to call once; it no-ops if already
   * discovered.
   */
  async initialize(_options?: InitializeOptions): Promise<NegotiatedSession> {
    if (this.session !== undefined) return this.session;
    if (this.state === 'created' || this.state === 'failed') {
      throw new Error(`cannot initialize from state "${this.state}"`);
    }
    this.setState('initializing');

    const discovered = await this.discover();
    this.discovered = discovered;

    const protocolVersion = selectSupportedVersion(discovered.supportedVersions, this.preferVersion);
    if (protocolVersion === undefined) {
      throw new Error(
        `server/discover returned no supported protocol version (supported: ${JSON.stringify(discovered.supportedVersions)})`,
      );
    }

    this.session = {
      protocolVersion,
      negotiated: protocolVersion !== this.preferVersion,
      claimedVersion: this.preferVersion,
      serverInfo: discovered.serverInfo,
      clientInfo: this.clientInfo,
      serverCapabilities: discovered.capabilities,
    };
    this.setState('operational');
    return this.session;
  }

  async discover(): Promise<DiscoverResult> {
    const result = await this.request('server/discover', undefined, this.discoverTimeoutMs);
    return parseDiscoverResult(result);
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
    const meta = this.buildRequestMeta();
    const modernParams = withRequestMeta(params, meta);

    let attemptId: JsonRpcId = id;
    let attemptParams: object | undefined = modernParams;
    const maxRetries = 8;

    for (let attempt = 0; ; attempt += 1) {
      const result = await this.sendRequest<T>(attemptId, method, attemptParams, timeoutMs, timeoutKind);
      // MRTR: server returned input_required — client must retry with inputResponses.
      if (this.autoMrtr && isInputRequiredResult(result)) {
        const responses = this.collectInputResponses(result);
        const requestState = parseRequestState(result);
        if (attempt >= maxRetries) {
          throw new JsonRpcRemoteError(-32602, `request could not be completed after ${maxRetries + 1} input responses`, result);
        }
        attemptId = this.idGen();
        attemptParams = buildInputRetryParams(modernParams, responses, requestState);
        continue;
      }
      return result as unknown as T;
    }
  }

  notify(method: string, params?: object): Promise<void> {
    let notificationParams: object | undefined = params;
    if (this.shouldAttachMeta(method)) {
      notificationParams = withRequestMeta(params, this.buildRequestMeta());
    }
    const notification = createNotification(method, notificationParams);
    this.traceOut(notification);
    return this.send(notification);
  }

  async shutdown(): Promise<void> {
    await Promise.race([
      this.transport.stop(),
      new Promise((resolve) => setTimeout(resolve, this.shutdownTimeoutMs)),
    ]);
    this.setState('closed');
  }

  async disconnect(): Promise<void> {
    await this.transport.stop();
    if (this.state !== 'closed') this.setState('closed');
  }

  /**
   * Open a `subscriptions/listen` stream (modern). Requires the transport to
   * support long-lived listen streams. Collects notifications (ack + change
   * notifications) into the returned subscription handle until the caller
   * cancels or the server closes the stream.
   */
  subscribe(filter: {
    toolsListChanged?: boolean;
    promptsListChanged?: boolean;
    resourcesListChanged?: boolean;
    resourceSubscriptions?: string[];
  }): ModernSubscription {
    const listen = (this.transport as { listen?: (m: unknown) => unknown }).listen;
    if (typeof listen !== 'function') {
      throw new Error('transport does not support subscriptions/listen');
    }
    const id = this.idGen();
    const params = withRequestMeta(filter as object, this.buildRequestMeta());
    const request = createRequest(id, 'subscriptions/listen', params);
    const stream = listen.call(this.transport, request) as {
      id: unknown;
      closed: Promise<void>;
      cancel(): Promise<void>;
      onFrame(handler: (message: unknown) => void): void;
    };
    const subscription = new ModernSubscription(id);
    stream.onFrame((message) => subscription.push(message));
    void stream.closed.then(() => subscription.close());
    subscription._cancel = () => stream.cancel();
    return subscription;
  }

  /** Collect `inputResponses` for the requests surfaced by an input_required result. */
  private collectInputResponses(result: unknown): Record<string, unknown> {
    const requests = parseInputRequests(result);
    const responses: Record<string, unknown> = {};
    if (requests === undefined) return responses;
    for (const [key, raw] of Object.entries(requests)) {
      const request = raw as Record<string, unknown>;
      const method = typeof request.method === 'string' ? request.method : undefined;
      const params = (request.params ?? {}) as Record<string, unknown>;
      responses[key] = buildInputResponse(method, params);
    }
    return responses;
  }

  private sendRequest<T>(
    id: JsonRpcId,
    method: string,
    params: object | undefined,
    timeoutMs: number | undefined,
    timeoutKind: TimeoutKind,
  ): Promise<T> {
    const request = createRequest(id, method, params);
    this.traceOut(request);
    const registered = this.mux.register(request, timeoutMs, timeoutKind);
    return (async () => {
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
        throw new JsonRpcRemoteError(response.error.code, response.error.message, response.error.data);
      }
      return response.result as T;
    })();
  }

  private buildRequestMeta(): ModernRequestMeta {
    return {
      protocolVersion: this.session?.protocolVersion ?? this.preferVersion,
      clientInfo: this.clientInfo,
      clientCapabilities: this.clientCapabilities,
    };
  }

  /**
   * Register discovered tool input schemas so `tools/call` can mirror
   * `x-mcp-header`-annotated parameters into `Mcp-Param-*` headers. No-op on
   * transports that do not support header mirroring.
   */
  setToolSchemas(tools: Array<{ name: string; inputSchema?: unknown }>): void {
    const setter = (this.transport as { setToolInputSchemas?(s: unknown): void }).setToolInputSchemas;
    if (typeof setter === 'function') setter.call(this.transport, tools);
  }

  // ---- Tasks extension (io.modelcontextprotocol/tasks) ----

  async tasksGet(taskId: string, timeoutMs?: number): Promise<Record<string, unknown>> {
    return (await this.request('tasks/get', { taskId }, timeoutMs)) as Record<string, unknown>;
  }

  async tasksUpdate(taskId: string, inputResponses: InputResponses, timeoutMs?: number): Promise<Record<string, unknown>> {
    return (await this.request('tasks/update', { taskId, inputResponses }, timeoutMs)) as Record<string, unknown>;
  }

  async tasksCancel(taskId: string, timeoutMs?: number): Promise<Record<string, unknown>> {
    return (await this.request('tasks/cancel', { taskId }, timeoutMs)) as Record<string, unknown>;
  }

  /**
   * Poll a task to completion following the Tasks extension protocol. Starts
   * from the `CreateTaskResult` returned by the originating request, then loops
   * `tasks/get` until a terminal status (completed/failed/cancelled). If a poll
   * returns `input_required`, the tester answers via `tasks/update`. Bounded by
   * `maxPollMs` (default `requestTimeoutMs`) and each `pollIntervalMs`.
   */
  async pollTask(taskId: string, options?: { maxPollMs?: number; pollIntervalMs?: number }): Promise<Record<string, unknown>> {
    const maxPollMs = options?.maxPollMs ?? this.requestTimeoutMs;
    const deadline = this.clock() + maxPollMs;
    let status: Record<string, unknown> = await this.tasksGet(taskId);
    for (;;) {
      const state = typeof status.status === 'string' ? status.status : undefined;
      if (state === 'completed' || state === 'failed' || state === 'cancelled') {
        return status;
      }
      if (state === 'input_required') {
        const responses = this.collectInputResponses(status);
        status = await this.tasksUpdate(taskId, responses);
        continue;
      }
      // working / unknown non-terminal — wait and re-poll.
      const interval = options?.pollIntervalMs ?? (typeof status.pollIntervalMs === 'number' ? status.pollIntervalMs : 200);
      if (this.clock() + interval > deadline) {
        throw new JsonRpcRemoteError(-32602, `task ${taskId} did not reach a terminal status within ${maxPollMs}ms`, status);
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
      status = await this.tasksGet(taskId);
    }
  }

  private shouldAttachMeta(method: string): boolean {
    // The modern protocol carries protocol metadata on every request; the
    // only client-sent notification is notifications/cancelled (stdio).
    return method !== 'notifications/shutdown';
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
    const key = typeof record.id === 'number' || typeof record.id === 'string' ? responseKey(record.id) : undefined;
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

  private traceIn(response: { id: JsonRpcId; error?: { code: number; message: string } | undefined }, requestId: JsonRpcId): void {
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

export function createModernProtocolAdapter(options: ModernAdapterOptions): ModernProtocolAdapter {
  return new ModernProtocolAdapter(options);
}

export interface SubscriptionNotification {
  method: string;
  params?: Record<string, unknown>;
  subscriptionId?: unknown;
}

/**
 * Client-side handle for a `subscriptions/listen` stream. Collects the
 * acknowledged notification and subsequent change notifications into `events`,
 * keyed by their `io.modelcontextprotocol/subscriptionId` in `_meta` when present.
 */
export class ModernSubscription {
  readonly id: unknown;
  private readonly list: unknown[] = [];
  private closedFlag = false;
  private resolveClosed: (() => void) | undefined;
  private readonly closePromise: Promise<void>;
  _cancel: (() => Promise<void>) | undefined;

  constructor(id: unknown) {
    this.id = id;
    this.closePromise = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  get closed(): Promise<void> {
    return this.closePromise;
  }

  get isClosed(): boolean {
    return this.closedFlag;
  }

  /** All JSON-RPC messages received so far on the stream. */
  get events(): readonly unknown[] {
    return this.list;
  }

  /** Change notifications (i.e. everything after the first/acknowledged frame). */
  get notifications(): readonly SubscriptionNotification[] {
    const out: SubscriptionNotification[] = [];
    for (const event of this.list) {
      const message = event as { method?: unknown; params?: unknown };
      if (typeof message.method !== 'string') continue;
      const params = message.params as Record<string, unknown> | undefined;
      const meta = (params?._meta ?? {}) as Record<string, unknown>;
      out.push({
        method: message.method,
        params,
        subscriptionId: meta['io.modelcontextprotocol/subscriptionId'],
      });
    }
    return out;
  }

  push(message: unknown): void {
    this.list.push(message);
  }

  close(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.resolveClosed?.();
  }

  async cancel(): Promise<void> {
    if (this._cancel !== undefined) await this._cancel();
    this.close();
  }
}
