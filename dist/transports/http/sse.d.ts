import type { Readable } from 'node:stream';
export interface SseFieldEvent {
    /** Event type from `event:` (e.g. `message`, `endpoint`, `name`). */
    readonly event: string | undefined;
    /** `data:` fields joined with `\n`. Empty string when absent. */
    readonly data: string;
    /** Optional `id:` field. */
    readonly id: string | undefined;
    /** Optional `retry:` field parsed as a non-negative integer. */
    readonly retry: number | undefined;
}
export interface SseErrorEvent {
    readonly kind: 'error';
    readonly message: string;
    readonly cause?: Error;
}
export type SseParserEvent = {
    kind: 'event';
    event: SseFieldEvent;
} | SseErrorEvent;
export interface SseParserOptions {
    /** Byte budget for the whole buffered stream before erroring. */
    maxBytes?: number;
    /** Byte budget for a single SSE frame before it is considered oversized. */
    maxEventBytes?: number;
}
/**
 * Incremental, dependency-free SSE parser.
 *
 * Feed raw bytes with `push()`; it splits on `\n\n` / `\r\n\r\n` boundaries,
 * tolerates a leading BOM, leading blank lines, `:` comment lines, multi-line
 * `data:` fields and CRLF line endings, and emits one parsed event per frame.
 */
export declare class SseParser {
    private buffer;
    private buffered;
    private started;
    private sawField;
    private eventName;
    private dataLines;
    private lastId;
    private retry;
    private readonly decoder;
    private readonly maxBytes?;
    private readonly maxEventBytes?;
    constructor(options?: SseParserOptions);
    get bufferedBytes(): number;
    push(chunk: Uint8Array | string): SseParserEvent[];
    flush(): SseParserEvent[];
    private drain;
    private handleFrame;
    private dispatch;
    private reset;
}
export interface ParseEventStreamOptions extends SseParserOptions {
    onError?: (message: string, cause?: Error) => void;
}
/** Parse an SSE body stream, invoking `onEvent` for each parsed frame. */
export declare function parseEventStream(stream: Readable, onEvent: (event: SseFieldEvent) => void, options?: ParseEventStreamOptions): Promise<void>;
