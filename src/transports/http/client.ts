import { type Dispatcher, request } from 'undici';

import type { AuthConfig, HttpRequestOptions } from './types.js';

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

function buildHeaders(
  headers: Record<string, string | undefined> | undefined,
  auth: AuthConfig | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers !== undefined) {
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) out[key] = value;
    }
  }
  if (auth !== undefined && auth.mode === 'bearer' && auth.token !== undefined) {
    out.Authorization = `Bearer ${auth.token}`;
  }
  return out;
}

function isSse(headers: ResponseHeaders): boolean {
  const contentType = normalizeHeader(headers, 'content-type');
  if (contentType === undefined) return false;
  const base = contentType.split(';', 1)[0]?.trim().toLowerCase();
  return base === 'text/event-stream';
}

export async function postJson(
  url: string,
  options: HttpRequestOptions,
): Promise<HttpRequestResult> {
  const headers = buildHeaders(options.headers, options.auth);
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);

  const response = await request(url, {
    method: options.method,
    headers,
    body,
    headersTimeout: options.timeoutMs,
    bodyTimeout: options.timeoutMs,
  });

  const contentType = normalizeHeader(response.headers, 'content-type');
  return {
    statusCode: response.statusCode,
    statusText: response.statusText,
    headers: response.headers,
    contentType,
    isEventStream: isSse(response.headers),
    text: () => response.body.text(),
    json: <T = unknown>() => response.body.json() as Promise<T>,
    stream: () => response.body,
  };
}

/**
 * Case-insensitive header lookup that tolerates both classic plain-object
 * headers and undici's `HeadersList` (array/iterator of `[name, value]`
 * pairs with proxied named access).
 */
export function normalizeHeader(headers: unknown, name: string): string | undefined {
  const lower = name.toLowerCase();
  if (headers === null || typeof headers !== 'object') return undefined;
  const record = headers as Record<string, unknown>;

  // 1) Direct proxied/plain key access (headers["content-type"]).
  const direct = record[lower];
  if (typeof direct === 'string') return direct;
  if (Array.isArray(direct)) return direct[0];

  // 2) Plain object with differently-cased keys.
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === lower) {
      const value = record[key];
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) return value[0];
    }
  }

  // 3) Iterable of [name, value] pairs (HeadersList iteration).
  const iterable = record as unknown as Iterable<unknown> | undefined;
  if (typeof iterable?.[Symbol.iterator] === 'function') {
    for (const item of iterable) {
      if (Array.isArray(item) && typeof item[0] === 'string' && item[0].toLowerCase() === lower) {
        const value = item[1];
        return Array.isArray(value) ? value[0] : String(value);
      }
    }
  }

  return undefined;
}

export function readBodyText(body: Dispatcher.ResponseData['body']): Promise<string> {
  return body.text();
}

export type { Dispatcher };
