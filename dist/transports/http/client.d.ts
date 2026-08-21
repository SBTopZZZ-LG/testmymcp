import { type Dispatcher } from 'undici';
import type { HttpRequestOptions } from './types.js';
export type ResponseHeaders = Dispatcher.ResponseData['headers'];
export interface HttpRequestResult {
    readonly statusCode: number;
    readonly statusText: string;
    readonly headers: ResponseHeaders;
    /** Content-Type of the response (lower-cased, without parameters). */
    readonly contentType: string | undefined;
    /** true when the response advertises a streaming text/event-stream body. */
    readonly isEventStream: boolean;
    /** Read the full body as text (streaming decode, not buffered via .json()). */
    text(): Promise<string>;
    /** Convenience JSON parse of the full body. */
    json<T = unknown>(): Promise<T>;
    /** The raw live body stream, for layering an SSE parser on top. */
    stream(): Dispatcher.ResponseData['body'];
}
export declare function postJson(url: string, options: HttpRequestOptions): Promise<HttpRequestResult>;
/**
 * Case-insensitive header lookup that tolerates both classic plain-object
 * headers and undici's `HeadersList` (array/iterator of `[name, value]`
 * pairs with proxied named access).
 */
export declare function normalizeHeader(headers: unknown, name: string): string | undefined;
export declare function readBodyText(body: Dispatcher.ResponseData['body']): Promise<string>;
export type { Dispatcher };
