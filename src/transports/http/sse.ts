import type { Readable } from 'node:stream';

import { CodecError } from '../../core/jsonrpc/codec.js';

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

export type SseParserEvent = { kind: 'event'; event: SseFieldEvent } | SseErrorEvent;

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
export class SseParser {
  private buffer = '';
  private buffered = 0;
  private started = false;
  private sawField = false;
  private eventName: string | undefined;
  private dataLines: string[] = [];
  private lastId: string | undefined;
  private retry: number | undefined;
  private readonly decoder: TextDecoder;
  private readonly maxBytes?: number;
  private readonly maxEventBytes?: number;

  constructor(options: SseParserOptions = {}) {
    this.decoder = new TextDecoder('utf-8');
    this.maxBytes = options.maxBytes;
    this.maxEventBytes = options.maxEventBytes;
  }

  get bufferedBytes(): number {
    return this.buffered;
  }

  push(chunk: Uint8Array | string): SseParserEvent[] {
    let incomingBytes: number;
    if (typeof chunk === 'string') {
      this.buffer += chunk;
      incomingBytes = Buffer.byteLength(chunk, 'utf8');
    } else {
      this.buffer += this.decoder.decode(chunk, { stream: true });
      incomingBytes = chunk.byteLength;
    }
    this.buffered += incomingBytes;

    if (this.maxBytes !== undefined && this.buffered > this.maxBytes) {
      this.reset();
      return [{ kind: 'error', message: `SSE stream exceeded ${this.maxBytes} bytes` }];
    }
    if (this.maxEventBytes !== undefined && this.buffered > this.maxEventBytes) {
      this.reset();
      return [{ kind: 'error', message: `SSE frame exceeded ${this.maxEventBytes} bytes` }];
    }

    return this.drain();
  }

  flush(): SseParserEvent[] {
    const events = this.drain();
    if (this.buffer.trim().length > 0) {
      const parsed = this.handleFrame(this.buffer.trim());
      if (parsed !== null) events.push(parsed);
      this.buffer = '';
      this.buffered = 0;
      this.started = false;
      this.sawField = false;
    }
    return events;
  }

  private drain(): SseParserEvent[] {
    const events: SseParserEvent[] = [];
    for (;;) {
      const boundary = findBoundary(this.buffer);
      if (boundary.start < 0) break;
      const frame = this.buffer.slice(0, boundary.start);
      this.buffer = this.buffer.slice(boundary.start + boundary.length);
      this.buffered = Buffer.byteLength(this.buffer, 'utf8');
      const parsed = this.handleFrame(frame);
      if (parsed !== null) events.push(parsed);
    }
    return events;
  }

  private handleFrame(frame: string): SseParserEvent | null {
    const lines = frame.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

      if (!this.started) {
        const stripped = line.replace(/^\uFEFF/, '');
        if (stripped.trim().length === 0) continue;
        this.started = true;
        this.sawField = false;
        this.eventName = undefined;
        this.dataLines = [];
        this.lastId = undefined;
        this.retry = undefined;
      }

      if (line.length === 0) continue;
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const rawValue = colon < 0 ? '' : line.slice(colon + 1);
      const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

      switch (field) {
        case 'event':
          this.eventName = value;
          this.sawField = true;
          break;
        case 'data':
          this.dataLines.push(value);
          this.sawField = true;
          break;
        case 'id':
          this.lastId = value;
          this.sawField = true;
          break;
        case 'retry': {
          if (!/^\d+$/.test(value)) {
            const error = new CodecError('invalid SSE retry field', line);
            return { kind: 'error', message: error.message, cause: error };
          }
          this.retry = Number(value);
          this.sawField = true;
          break;
        }
        default:
          break;
      }
    }
    return this.dispatch();
  }

  private dispatch(): SseParserEvent | null {
    if (!this.sawField) return null;
    const event: SseFieldEvent = {
      event: this.eventName,
      data: this.dataLines.join('\n'),
      id: this.lastId,
      retry: this.retry,
    };
    this.started = false;
    this.sawField = false;
    this.eventName = undefined;
    this.dataLines = [];
    this.lastId = undefined;
    this.retry = undefined;
    return { kind: 'event', event };
  }

  private reset(): void {
    this.buffer = '';
    this.buffered = 0;
    this.started = false;
    this.sawField = false;
    this.eventName = undefined;
    this.dataLines = [];
    this.lastId = undefined;
    this.retry = undefined;
  }
}

/**
 * Locate the next SSE frame boundary (`\r\n\r\n` or `\n\n`), preferring the
 * earliest one. Returns the index where frame content ends and the length of
 * the separator so the caller can slice the buffer.
 */
function findBoundary(buffer: string): { start: number; length: number } {
  const crlf = buffer.indexOf('\r\n\r\n');
  const lf = buffer.indexOf('\n\n');
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) {
    return { start: crlf, length: 4 };
  }
  if (lf >= 0) {
    return { start: lf, length: 2 };
  }
  return { start: -1, length: 0 };
}

export interface ParseEventStreamOptions extends SseParserOptions {
  onError?: (message: string, cause?: Error) => void;
}

/** Parse an SSE body stream, invoking `onEvent` for each parsed frame. */
export async function parseEventStream(
  stream: Readable,
  onEvent: (event: SseFieldEvent) => void,
  options: ParseEventStreamOptions = {},
): Promise<void> {
  const parser = new SseParser(options);
  const onError = options.onError;

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      const events = parser.push(chunk);
      for (const parsed of events) {
        if (parsed.kind === 'event') onEvent(parsed.event);
        else onError?.(parsed.message, parsed.cause);
      }
    });
    stream.on('end', () => {
      const remaining = parser.flush();
      for (const parsed of remaining) {
        if (parsed.kind === 'event') onEvent(parsed.event);
        else onError?.(parsed.message, parsed.cause);
      }
      resolve();
    });
    stream.on('error', (error) => reject(error));
  });
}
