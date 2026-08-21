import { randomUUID } from 'node:crypto';

import type { TraceMessage, TraceStoreJson } from '../types/trace.js';
import { redactDeep, redactString } from './redaction.js';

const DEFAULT_MAX_ENTRIES = 10_000;

export interface TraceStoreOptions {
  redact?: boolean;
  showSecrets?: boolean;
  maxEntries?: number;
}

export type TraceInput = Omit<TraceMessage, 'id' | 'timestamp'> & {
  id?: string;
  timestamp?: number;
};

export class TraceStore {
  private readonly messages: TraceMessage[] = [];
  private readonly redact: boolean;
  private readonly showSecrets: boolean;
  private readonly maxEntries: number;

  constructor(options: TraceStoreOptions = {}) {
    this.redact = options.redact ?? true;
    this.showSecrets = options.showSecrets ?? false;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  get size(): number {
    return this.messages.length;
  }

  get isTruncated(): boolean {
    return this.messages.length >= this.maxEntries;
  }

  add(input: TraceInput): TraceMessage {
    const raw =
      this.redact && !this.showSecrets && input.raw !== undefined
        ? redactString(input.raw)
        : input.raw;
    const payload =
      input.payload === undefined || !this.redact || this.showSecrets
        ? input.payload
        : redactDeep(input.payload);
    const message: TraceMessage = {
      ...input,
      id: input.id ?? randomUUID(),
      timestamp: input.timestamp ?? Date.now(),
      raw,
      payload,
    };
    if (this.messages.length >= this.maxEntries) {
      this.messages.shift();
    }
    this.messages.push(message);
    return message;
  }

  all(): readonly TraceMessage[] {
    return this.messages;
  }

  byRequestId(requestId: TraceMessage['requestId']): TraceMessage[] {
    return this.messages.filter((message) => message.requestId === requestId);
  }

  byMethod(method: string): TraceMessage[] {
    return this.messages.filter((message) => message.method === method);
  }

  timeline(): TraceMessage[] {
    return [...this.messages].sort((a, b) => a.timestamp - b.timestamp);
  }

  clear(): void {
    this.messages.length = 0;
  }

  toJSON(): TraceStoreJson {
    return {
      kind: 'mcp-trace',
      version: 1,
      count: this.messages.length,
      messages: [...this.messages],
    };
  }
}
