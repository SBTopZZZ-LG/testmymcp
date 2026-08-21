import type { Readable } from 'node:stream';

import { isNotification, isRequest, isResponse } from '../../core/jsonrpc/messages.js';
import type { ProtocolVersion } from '../../core/types/protocol.js';
import type { ListenStream, Transport, TransportObserver } from '../transport.js';
import { type HttpRequestResult, normalizeHeader, postJson } from './client.js';
import {
  type HeaderIssue,
  buildRequestHeaders,
  readJsonResponseHeaders,
  validateJsonResponseHeaders,
} from './header-routing.js';
import { SseParser } from './sse.js';
import type { AuthConfig } from './types.js';
import { HTTP_CONTENT_TYPES } from './types.js';
import { buildMcpParamHeaders } from './x-mcp-header.js';

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
export class StreamableHttpTransport implements Transport {
  readonly kind = 'streamable-http' as const;
  observer?: TransportObserver;

  private readonly options: StreamableHttpTransportOptions;
  private sessionValue: string | undefined;
  private started = false;
  private stopping = false;
  private issues: HeaderIssue[] = [];
  private lastMethod: string | undefined;
  private toolInputSchemas = new Map<string, unknown>();

  constructor(options: StreamableHttpTransportOptions) {
    this.options = options;
  }

  get stderrLines(): readonly string[] {
    return [];
  }

  get exited() {
    return null;
  }

  get sessionId(): string | undefined {
    return this.sessionValue;
  }

  get headerIssues(): readonly HeaderIssue[] {
    return this.issues;
  }

  get lastRequestMethod(): string | undefined {
    return this.lastMethod;
  }

  /** Register discovered tool input schemas so `tools/call` can mirror `Mcp-Param-*`. */
  setToolInputSchemas(schemas: Iterable<{ name: string; inputSchema?: unknown }>): void {
    this.toolInputSchemas = new Map();
    for (const tool of schemas) {
      if (tool.name !== undefined && tool.inputSchema !== undefined)
        this.toolInputSchemas.set(tool.name, tool.inputSchema);
    }
  }

  isOpen(): boolean {
    return this.started && !this.stopping;
  }

  async start(): Promise<void> {
    if (this.started) throw new Error('streamable HTTP transport already started');
    this.started = true;
    this.stopping = false;
  }

  async send(message: unknown): Promise<void> {
    if (!this.started || this.stopping) throw new Error('transport not started');
    const method = extractMethod(message);
    this.lastMethod = method;

    const isModern = this.options.era === 'modern';
    const accept = this.options.accept ?? (isModern ? 'json' : 'json');
    const acceptValue =
      isModern || accept === 'sse'
        ? `${HTTP_CONTENT_TYPES.JSON}, ${HTTP_CONTENT_TYPES.SSE}`
        : HTTP_CONTENT_TYPES.JSON;

    const headers = buildRequestHeaders({
      protocolVersion: this.options.protocolVersion,
      accept: acceptValue,
    });

    // Modern (2026-07-28) is stateless: no Mcp-Session-Id, and the client must
    // mirror Mcp-Method / Mcp-Name on every request.
    if (isModern) {
      const name = extractRequestName(message);
      if (method !== undefined) headers['Mcp-Method'] = method;
      if (name !== undefined) headers['Mcp-Name'] = name;
      // Mirror x-mcp-header-tagged tool parameters into Mcp-Param-{Name} headers.
      if (method === 'tools/call') {
        const callParams = (message as { params?: { name?: unknown; arguments?: unknown } }).params;
        const toolName = typeof callParams?.name === 'string' ? callParams.name : undefined;
        if (toolName !== undefined) {
          const schema = this.toolInputSchemas.get(toolName);
          if (schema !== undefined) {
            const mirrored = buildMcpParamHeaders(schema, callParams?.arguments);
            for (const [key, value] of Object.entries(mirrored)) headers[key] = value;
          }
        }
      }
    } else if (this.sessionValue !== undefined) {
      headers['Mcp-Session-Id'] = this.sessionValue;
    }

    const result = await postJson(this.options.url, {
      url: this.options.url,
      method: 'POST',
      headers,
      body: message,
      auth: this.options.auth,
      timeoutMs: this.options.requestTimeoutMs,
    });

    // Legacy session lifecycle only: capture Mcp-Session-Id from the response.
    if (!isModern) {
      const sessionId = normalizeHeader(result.headers, 'mcp-session-id');
      if (sessionId !== undefined && sessionId.length > 0) this.sessionValue = sessionId;
    }

    if (result.statusCode < 200 || result.statusCode >= 300) {
      const text = await readText(result).catch(() => '');
      this.observer?.onError?.(
        new Error(`server returned HTTP ${result.statusCode} (${result.statusText})`),
      );
      throw new Error(
        `server returned HTTP ${result.statusCode} (${result.statusText}): ${text || 'no response body'}`,
      );
    }

    if (method !== undefined && (this.options.validateHeaders ?? true) && !result.isEventStream) {
      const view = readJsonResponseHeaders(result.headers, normalizeHeader);
      const outcome = validateJsonResponseHeaders(
        { protocolVersion: view.protocolVersion, method: view.method, name: view.name },
        method,
        { expectProtocolVersion: this.options.protocolVersion, modern: isModern },
      );
      this.issues = [...outcome.issues];
    } else {
      this.issues = [];
    }

    if (result.isEventStream) {
      await this.consumeEventStream(result);
      return;
    }

    const payload = await result.json().catch(() => undefined);
    this.dispatchPayload(payload);
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.stopping = true;
    this.started = false;
    // Abort any active listen streams.
    for (const stream of this.activeStreams) void stream.cancel();
    this.activeStreams.clear();
  }

  private readonly activeStreams = new Set<ListenStreamImpl>();

  /**
   * Open a `subscriptions/listen` stream. Sends the request via POST, keeps the
   * SSE response stream open, and forwards every parsed JSON-RPC message
   * (ack + notifications) to the observer until the stream ends or the
   * subscription is cancelled. The request must be a JSON-RPC request with an id.
   */
  listen(message: unknown): ListenStream {
    const method = extractMethod(message);
    const id = (message as { id?: unknown }).id;
    if (method === undefined || !isJsonRpcId(id)) {
      throw new Error('listen requires a JSON-RPC request with an id');
    }
    this.lastMethod = method;

    const isModern = this.options.era === 'modern';
    const accept = isModern
      ? `${HTTP_CONTENT_TYPES.JSON}, ${HTTP_CONTENT_TYPES.SSE}`
      : HTTP_CONTENT_TYPES.JSON;
    const headers = buildRequestHeaders({
      protocolVersion: this.options.protocolVersion,
      accept,
    });
    if (isModern) {
      if (method !== undefined) headers['Mcp-Method'] = method;
    } else if (this.sessionValue !== undefined) {
      headers['Mcp-Session-Id'] = this.sessionValue;
    }

    const stream = new ListenStreamImpl(id);
    this.activeStreams.add(stream);

    void (async () => {
      try {
        let result: HttpRequestResult;
        try {
          result = await postJson(this.options.url, {
            url: this.options.url,
            method: 'POST',
            headers,
            body: message,
            auth: this.options.auth,
            timeoutMs: this.options.requestTimeoutMs,
          });
        } catch (error) {
          throw error;
        }

        if (result.statusCode < 200 || result.statusCode >= 300) {
          const text = await readText(result).catch(() => '');
          this.observer?.onError?.(
            new Error(`server returned HTTP ${result.statusCode} (${result.statusText})`),
          );
          stream.fail(
            new Error(
              `server returned HTTP ${result.statusCode} (${result.statusText}): ${text || 'no response body'}`,
            ),
          );
          return;
        }

        if (!result.isEventStream) {
          // Server answered with a plain object (e.g. empty listen result on graceful close).
          const payload = await result.json().catch(() => undefined);
          this.dispatchPayload(payload);
          stream.close();
          return;
        }

        this.consumeOpenStream(result, stream);
      } catch (error) {
        stream.fail(error instanceof Error ? error : new Error(String(error)));
      }
    })();

    return stream;
  }

  private consumeOpenStream(result: HttpRequestResult, stream: ListenStreamImpl): void {
    const parser = new SseParser({
      maxBytes: this.options.maxEventBytes,
      maxEventBytes: this.options.maxEventBytes,
    });
    const body = result.stream() as unknown as Readable;

    const finish = (): void => {
      if (stream.isClosed()) return;
      stream.close();
    };
    const onChunk = (chunk: Buffer): void => {
      for (const event of parser.push(chunk)) {
        if (event.kind === 'error') {
          this.observer?.onError?.(new Error(event.message));
          continue;
        }
        this.handleOpenFrame(event.event, stream);
      }
    };
    body.on('data', onChunk);
    body.on('end', finish);
    body.on('error', () => finish());

    stream.onCancel(() => {
      try {
        body.destroy();
      } catch {
        /* ignore */
      }
      finish();
    });
  }

  private handleOpenFrame(frame: { event?: string; data: string }, stream: ListenStreamImpl): void {
    if (frame.event !== undefined && frame.event !== 'message') return;
    if (frame.data.length === 0) return;
    let payload: unknown;
    try {
      payload = JSON.parse(frame.data) as unknown;
    } catch {
      this.observer?.onGarbage?.(frame.data);
      return;
    }
    this.dispatchPayload(payload);
    stream.emit(payload);
  }

  /** Routes a parsed payload to the observer; returns true when a JSON-RPC response was delivered. */
  private dispatchPayload(payload: unknown): boolean {
    if (payload === null || payload === undefined) return false; // notification with no reply
    if (isResponse(payload)) {
      this.observer?.onMessage?.(payload);
      return true;
    }
    if (isRequest(payload) || isNotification(payload)) {
      this.observer?.onMessage?.(payload);
      return false;
    }
    this.observer?.onGarbage?.(safeStringify(payload));
    return false;
  }

  private async consumeEventStream(result: HttpRequestResult): Promise<void> {
    const parser = new SseParser({
      maxBytes: this.options.maxEventBytes,
      maxEventBytes: this.options.maxEventBytes,
    });
    const body = result.stream() as unknown as Readable;

    await new Promise<void>((resolve) => {
      let settled = false;
      let finish: () => void = () => {};
      const guard = setTimeout(() => finish(), this.options.requestTimeoutMs ?? 30_000);
      guard.unref?.();
      finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        try {
          body.destroy();
        } catch {
          /* ignore */
        }
        resolve();
      };

      body.on('data', (chunk) => {
        let responseDelivered = false;
        for (const event of parser.push(chunk)) {
          if (event.kind === 'error') {
            this.observer?.onError?.(new Error(event.message));
            continue;
          }
          if (this.handleSseFrame(event.event)) responseDelivered = true;
        }
        // The multiplexer resolves once the matching response arrives; stop
        // reading an SSE stream that the server may keep open in the meantime.
        if (responseDelivered) finish();
      });
      body.on('end', finish);
      body.on('error', finish);
    });
  }

  /** Returns true iff the frame carried a JSON-RPC response. */
  private handleSseFrame(frame: { event?: string; data: string }): boolean {
    if (frame.event !== undefined && frame.event !== 'message') return false;
    if (frame.data.length === 0) return false;
    let payload: unknown;
    try {
      payload = JSON.parse(frame.data) as unknown;
    } catch {
      this.observer?.onGarbage?.(frame.data);
      return false;
    }
    return this.dispatchPayload(payload);
  }
}

function extractMethod(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const method = (message as { method?: unknown }).method;
  return typeof method === 'string' ? method : undefined;
}

/**
 * Extract the `Mcp-Name` header source: `params.name` (tools/call, prompts/get)
 * or `params.uri` (resources/read). Values that are not plain ASCII are
 * Base64-encoded with the `=?base64?...?=` sentinel format per the spec.
 */
function extractRequestName(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const params = (message as { params?: Record<string, unknown> }).params;
  if (params === null || typeof params !== 'object') return undefined;
  const method = extractMethod(message);
  const raw = method === 'resources/read' ? params.uri : params.name;
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw);
  return encodeHeaderValue(value);
}

function isPlainAscii(value: string): boolean {
  return /^[\x20-\x7E]*$/.test(value) && value === value.trim();
}

function encodeHeaderValue(value: string): string {
  // Plain ASCII, no surrounding whitespace, and not already a sentinel -> as-is.
  if (isPlainAscii(value) && !/^=\?base64\?/.test(value)) return value;
  return `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function readText(result: HttpRequestResult): Promise<string> {
  return result.text();
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isJsonRpcId(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string';
}

class ListenStreamImpl implements ListenStream {
  readonly id: unknown;
  private settled = false;
  private cancelHandler: (() => void) | undefined;
  private resolveClosed: () => void = () => {};
  readonly closed: Promise<void>;
  readonly events: unknown[] = [];
  private readonly frameHandlers: Array<(message: unknown) => void> = [];

  constructor(id: unknown) {
    this.id = id;
    this.closed = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  isClosed(): boolean {
    return this.settled;
  }

  /** Record a parsed JSON-RPC message and notify subscribers. */
  onFrame(handler: (message: unknown) => void): void {
    this.frameHandlers.push(handler);
    for (const event of this.events) handler(event);
  }

  emit(message: unknown): void {
    this.events.push(message);
    for (const handler of this.frameHandlers) handler(message);
  }

  onCancel(handler: () => void): void {
    this.cancelHandler = handler;
  }

  close(): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveClosed();
  }

  fail(_error: Error): void {
    this.settled = true;
    this.resolveClosed();
  }

  async cancel(): Promise<void> {
    if (this.settled) return;
    this.cancelHandler?.();
    this.close();
  }
}
