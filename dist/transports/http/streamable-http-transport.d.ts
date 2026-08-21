import type { ProtocolVersion } from '../../core/types/protocol.js';
import type { ListenStream, Transport, TransportObserver } from '../transport.js';
import { type HeaderIssue } from './header-routing.js';
import type { AuthConfig } from './types.js';
export type StreamableHttpAccept = 'json' | 'sse';
export interface StreamableHttpTransportOptions {
    /** The POST endpoint, e.g. `http://127.0.0.1:8937/`. */
    url: string;
    auth?: AuthConfig;
    /** Which response format the client asks for. Default `json`. */
    accept?: StreamableHttpAccept;
    /** Sent as the `MCP-Protocol-Version` request header when present. */
    protocolVersion?: ProtocolVersion;
    /** Protocol era: modern (2026-07-28, stateless) or legacy (session-based). Default `legacy`. */
    era?: 'modern' | 'legacy';
    requestTimeoutMs?: number;
    maxEventBytes?: number;
    /** Validate the header-routing contract on single-message responses. */
    validateHeaders?: boolean;
}
/**
 * Streamable-HTTP transport.
 *
 * Session lifecycle: the `Mcp-Session-Id` returned on the first response
 * (typically `initialize`) is captured and echoed on every subsequent request,
 * which is the only piece of session state the transport must own (the adapter
 * correlates JSON-RPC responses by id through its multiplexer).
 */
export declare class StreamableHttpTransport implements Transport {
    readonly kind: "streamable-http";
    observer?: TransportObserver;
    private readonly options;
    private sessionValue;
    private started;
    private stopping;
    private issues;
    private lastMethod;
    private toolInputSchemas;
    constructor(options: StreamableHttpTransportOptions);
    get stderrLines(): readonly string[];
    get exited(): null;
    get sessionId(): string | undefined;
    get headerIssues(): readonly HeaderIssue[];
    get lastRequestMethod(): string | undefined;
    /** Register discovered tool input schemas so `tools/call` can mirror `Mcp-Param-*`. */
    setToolInputSchemas(schemas: Iterable<{
        name: string;
        inputSchema?: unknown;
    }>): void;
    isOpen(): boolean;
    start(): Promise<void>;
    send(message: unknown): Promise<void>;
    stop(): Promise<void>;
    private readonly activeStreams;
    /**
     * Open a `subscriptions/listen` stream. Sends the request via POST, keeps the
     * SSE response stream open, and forwards every parsed JSON-RPC message
     * (ack + notifications) to the observer until the stream ends or the
     * subscription is cancelled. The request must be a JSON-RPC request with an id.
     */
    listen(message: unknown): ListenStream;
    private consumeOpenStream;
    private handleOpenFrame;
    /** Routes a parsed payload to the observer; returns true when a JSON-RPC response was delivered. */
    private dispatchPayload;
    private consumeEventStream;
    /** Returns true iff the frame carried a JSON-RPC response. */
    private handleSseFrame;
}
