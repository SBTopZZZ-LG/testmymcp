import { randomUUID } from 'node:crypto';
import { redactDeep, redactString } from './redaction.js';
const DEFAULT_MAX_ENTRIES = 10_000;
export class TraceStore {
    messages = [];
    redact;
    showSecrets;
    maxEntries;
    constructor(options = {}) {
        this.redact = options.redact ?? true;
        this.showSecrets = options.showSecrets ?? false;
        this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    }
    get size() {
        return this.messages.length;
    }
    get isTruncated() {
        return this.messages.length >= this.maxEntries;
    }
    add(input) {
        const raw = this.redact && !this.showSecrets && input.raw !== undefined
            ? redactString(input.raw)
            : input.raw;
        const payload = input.payload === undefined || !this.redact || this.showSecrets
            ? input.payload
            : redactDeep(input.payload);
        const message = {
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
    all() {
        return this.messages;
    }
    byRequestId(requestId) {
        return this.messages.filter((message) => message.requestId === requestId);
    }
    byMethod(method) {
        return this.messages.filter((message) => message.method === method);
    }
    timeline() {
        return [...this.messages].sort((a, b) => a.timestamp - b.timestamp);
    }
    clear() {
        this.messages.length = 0;
    }
    toJSON() {
        return {
            kind: 'mcp-trace',
            version: 1,
            count: this.messages.length,
            messages: [...this.messages],
        };
    }
}
//# sourceMappingURL=store.js.map