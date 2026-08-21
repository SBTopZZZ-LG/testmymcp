export class CodecError extends Error {
  readonly line: string;
  readonly causeError?: Error;

  constructor(message: string, line: string, causeError?: Error) {
    super(`${message}: ${line}`);
    this.name = 'CodecError';
    this.line = line;
    this.causeError = causeError;
  }
}

export function encodeNdjson(message: unknown): string {
  return JSON.stringify(message) + '\n';
}

export function parseNdjsonLine(line: string): unknown {
  const trimmed = line.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    throw new CodecError('invalid JSON line', trimmed, error);
  }
}

export type NdjsonEvent =
  | { kind: 'message'; message: unknown }
  | { kind: 'garbage'; line: string }
  | { kind: 'oversize'; bytes: number };

export interface NdjsonReaderOptions {
  encoding?: string;
  onLine?: (line: string) => void;
  maxBytes?: number;
}

export class NdjsonReader {
  private buffer = '';
  private buffered = 0;
  private readonly decoder: TextDecoder;
  private readonly onLine?: (line: string) => void;
  private readonly maxBytes?: number;

  constructor(options: NdjsonReaderOptions = {}) {
    this.decoder = new TextDecoder(options.encoding ?? 'utf-8');
    this.onLine = options.onLine;
    this.maxBytes = options.maxBytes;
  }

  get bufferedBytes(): number {
    return this.buffered;
  }

  push(chunk: Uint8Array | string): NdjsonEvent[] {
    let incomingBytes: number;
    if (typeof chunk === 'string') {
      this.buffer += chunk;
      incomingBytes = Buffer.byteLength(chunk, 'utf8');
    } else {
      this.buffer += this.decoder.decode(chunk, { stream: true });
      incomingBytes = chunk.byteLength;
    }
    this.buffered += incomingBytes;

    const events: NdjsonEvent[] = [];
    if (this.maxBytes !== undefined && this.buffered > this.maxBytes) {
      events.push({ kind: 'oversize', bytes: this.buffered });
      this.buffer = '';
      this.buffered = 0;
      return events;
    }

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    this.buffered = Buffer.byteLength(this.buffer, 'utf8');
    for (const raw of lines) {
      const line = raw.trim();
      if (line.length === 0) continue;
      this.onLine?.(line);
      try {
        events.push({ kind: 'message', message: parseNdjsonLine(line) });
      } catch {
        events.push({ kind: 'garbage', line });
      }
    }
    return events;
  }

  flush(): NdjsonEvent[] {
    const remaining = this.buffer.trim();
    this.buffer = '';
    this.buffered = 0;
    if (remaining.length === 0) return [];
    this.onLine?.(remaining);
    try {
      return [{ kind: 'message', message: parseNdjsonLine(remaining) }];
    } catch {
      return [{ kind: 'garbage', line: remaining }];
    }
  }
}
