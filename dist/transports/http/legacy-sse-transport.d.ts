import type { Transport, TransportObserver } from '../transport.js';
import type { AuthConfig } from './types.js';
export interface LegacySseTransportOptions {
    /** The SSE stream endpoint, e.g. `http://127.0.0.1:8937/sse`. */
    url: string;
    /** Optional explicit messages endpoint; otherwise learnt from the `endpoint` event. */
    messagesUrl?: string;
    auth?: AuthConfig;
    requestTimeoutMs?: number;
    maxEventBytes?: number;
}
/**
 * Legacy SSE transport.
 *
 * Lifecycle: `start()` opens a long-lived `GET` SSE stream (mirroring
 * `GET /sse`), learns the `POST` messages endpoint from the `endpoint`
 * handshake event, then keeps consuming the stream in the background. Each
 * `send()` POSTs a JSON-RPC message to the messages endpoint; the corresponding
 * response arrives later as an `event: message` frame on the stream and is
 * routed to the observer (the adapter's multiplexer correlates it by id).
 */
export declare class LegacySseTransport implements Transport {
    readonly kind: "legacy-sse";
    observer?: TransportObserver;
    private readonly options;
    private messagesValue;
    private sessionValue;
    private body;
    private started;
    private stopping;
    constructor(options: LegacySseTransportOptions);
    get stderrLines(): readonly string[];
    get exited(): null;
    get sessionId(): string | undefined;
    get messagesUrl(): string | undefined;
    isOpen(): boolean;
    start(): Promise<void>;
    send(message: unknown): Promise<void>;
    stop(): Promise<void>;
    private resolveMessagesUrl;
    private waitForMessagesUrl;
    private consumeStream;
    private handleStreamEvent;
}
