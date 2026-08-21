import type { JsonRpcId, JsonRpcRequest, JsonRpcResponse } from './messages.js';
import { isResponse, responseKey } from './messages.js';
import { TimeoutError, type TimeoutKind } from '../timeouts/deadline.js';

export class DuplicateRequestIdError extends Error {
  readonly id: JsonRpcId;

  constructor(id: JsonRpcId) {
    super(`request id is already pending: ${String(id)}`);
    this.name = 'DuplicateRequestIdError';
    this.id = id;
  }
}

export class JsonRpcRemoteError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(`JSON-RPC error ${code}: ${message}`);
    this.name = 'JsonRpcRemoteError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

interface PendingEntry {
  request: JsonRpcRequest;
  createdAt: number;
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface MultiplexerOptions {
  timeoutMs?: number;
  clock?: () => number;
}

export class RequestMultiplexer {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly clock: () => number;
  private readonly defaultTimeoutMs?: number;

  constructor(options: MultiplexerOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.defaultTimeoutMs = options.timeoutMs;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  get pendingIds(): JsonRpcId[] {
    return [...this.pending.values()].map((entry) => entry.request.id);
  }

  isPending(id: JsonRpcId): boolean {
    return this.pending.has(responseKey(id));
  }

  register(request: JsonRpcRequest, timeoutMs?: number, timeoutKind: TimeoutKind = 'request'): Promise<JsonRpcResponse> {
    const key = responseKey(request.id);
    if (this.pending.has(key)) return Promise.reject(new DuplicateRequestIdError(request.id));
    const deadline = timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (deadline !== undefined && deadline > 0) {
        timer = setTimeout(() => {
          this.pending.delete(key);
          reject(
            new TimeoutError(timeoutKind, deadline, `${request.method} timed out after ${deadline}ms`),
          );
        }, deadline);
        if (typeof timer.unref === 'function') timer.unref();
      }
      this.pending.set(key, {
        request,
        createdAt: this.clock(),
        resolve: (response) => {
          if (timer !== undefined) clearTimeout(timer);
          this.pending.delete(key);
          resolve(response);
        },
        reject: (error) => {
          if (timer !== undefined) clearTimeout(timer);
          this.pending.delete(key);
          reject(error);
        },
        timer,
      });
    });
  }

  handleMessage(message: unknown): void {
    if (!isResponse(message)) return;
    const key = responseKey(message.id);
    const entry = this.pending.get(key);
    if (entry === undefined) return;
    this.pending.delete(key);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    if (message.error !== undefined) {
      entry.reject(new JsonRpcRemoteError(message.error.code, message.error.message, message.error.data));
    } else {
      entry.resolve(message);
    }
  }

  failById(id: JsonRpcId, error: Error): void {
    const key = responseKey(id);
    const entry = this.pending.get(key);
    if (entry === undefined) return;
    this.pending.delete(key);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.reject(error);
  }

  failAll(error: Error): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      entry.reject(error);
    }
  }
}