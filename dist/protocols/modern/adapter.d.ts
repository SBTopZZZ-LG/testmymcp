import { type IdStyle } from '../../core/jsonrpc/id.js';
import { type JsonRpcId } from '../../core/jsonrpc/messages.js';
import { RequestMultiplexer } from '../../core/jsonrpc/multiplexer.js';
import type { InitializeOptions, LifecycleState, NegotiatedSession, ProtocolAdapter, ServerInfo } from '../../core/protocol/adapter.js';
import type { ClientCapabilities } from '../../core/protocol/capabilities.js';
import type { TimeoutKind } from '../../core/timeouts/deadline.js';
import type { TraceStore } from '../../core/tracing/store.js';
import type { ProtocolEra, ProtocolVersion } from '../../core/types/protocol.js';
import type { Transport } from '../../transports/transport.js';
import { type DiscoverResult } from './discover.js';
import { type InputResponses } from './mrtr.js';
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
export declare class ModernProtocolAdapter implements ProtocolAdapter {
    readonly era: ProtocolEra;
    readonly mux: RequestMultiplexer;
    private readonly transport;
    private readonly clientInfo;
    private readonly clientCapabilities;
    private readonly preferVersion;
    private readonly requestTimeoutMs;
    private readonly discoverTimeoutMs;
    private readonly shutdownTimeoutMs;
    private readonly idGen;
    private readonly trace?;
    private readonly clock;
    private readonly startedAt;
    private readonly autoMrtr;
    private lifecycleState;
    private session;
    private discovered;
    constructor(options: ModernAdapterOptions);
    get state(): LifecycleState;
    get discoverResult(): DiscoverResult | undefined;
    connect(): Promise<void>;
    /**
     * Modern protocol has no `initialize` handshake. This performs the optional
     * `server/discover` RPC to populate the session (supported versions,
     * capabilities, identity). It is safe to call once; it no-ops if already
     * discovered.
     */
    initialize(_options?: InitializeOptions): Promise<NegotiatedSession>;
    discover(): Promise<DiscoverResult>;
    request<T = unknown>(method: string, params?: object, timeoutMs?: number): Promise<T>;
    rawRequest<T = unknown>(id: JsonRpcId, method: string, params?: object, timeoutMs?: number, timeoutKind?: TimeoutKind): Promise<T>;
    notify(method: string, params?: object): Promise<void>;
    shutdown(): Promise<void>;
    disconnect(): Promise<void>;
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
    }): ModernSubscription;
    /** Collect `inputResponses` for the requests surfaced by an input_required result. */
    private collectInputResponses;
    private sendRequest;
    private buildRequestMeta;
    /**
     * Register discovered tool input schemas so `tools/call` can mirror
     * `x-mcp-header`-annotated parameters into `Mcp-Param-*` headers. No-op on
     * transports that do not support header mirroring.
     */
    setToolSchemas(tools: Array<{
        name: string;
        inputSchema?: unknown;
    }>): void;
    tasksGet(taskId: string, timeoutMs?: number): Promise<Record<string, unknown>>;
    tasksUpdate(taskId: string, inputResponses: InputResponses, timeoutMs?: number): Promise<Record<string, unknown>>;
    tasksCancel(taskId: string, timeoutMs?: number): Promise<Record<string, unknown>>;
    /**
     * Poll a task to completion following the Tasks extension protocol. Starts
     * from the `CreateTaskResult` returned by the originating request, then loops
     * `tasks/get` until a terminal status (completed/failed/cancelled). If a poll
     * returns `input_required`, the tester answers via `tasks/update`. Bounded by
     * `maxPollMs` (default `requestTimeoutMs`) and each `pollIntervalMs`.
     */
    pollTask(taskId: string, options?: {
        maxPollMs?: number;
        pollIntervalMs?: number;
    }): Promise<Record<string, unknown>>;
    private shouldAttachMeta;
    private setState;
    private send;
    private traceOut;
    private traceIn;
}
export declare function createModernProtocolAdapter(options: ModernAdapterOptions): ModernProtocolAdapter;
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
export declare class ModernSubscription {
    readonly id: unknown;
    private readonly list;
    private closedFlag;
    private resolveClosed;
    private readonly closePromise;
    _cancel: (() => Promise<void>) | undefined;
    constructor(id: unknown);
    get closed(): Promise<void>;
    get isClosed(): boolean;
    /** All JSON-RPC messages received so far on the stream. */
    get events(): readonly unknown[];
    /** Change notifications (i.e. everything after the first/acknowledged frame). */
    get notifications(): readonly SubscriptionNotification[];
    push(message: unknown): void;
    close(): void;
    cancel(): Promise<void>;
}
