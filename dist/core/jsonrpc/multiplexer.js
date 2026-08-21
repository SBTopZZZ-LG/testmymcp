import { TimeoutError } from '../timeouts/deadline.js';
import { isResponse, responseKey } from './messages.js';
export class DuplicateRequestIdError extends Error {
    id;
    constructor(id) {
        super(`request id is already pending: ${String(id)}`);
        this.name = 'DuplicateRequestIdError';
        this.id = id;
    }
}
export class JsonRpcRemoteError extends Error {
    code;
    data;
    constructor(code, message, data) {
        super(`JSON-RPC error ${code}: ${message}`);
        this.name = 'JsonRpcRemoteError';
        this.code = code;
        if (data !== undefined)
            this.data = data;
    }
}
export class RequestMultiplexer {
    pending = new Map();
    clock;
    defaultTimeoutMs;
    constructor(options = {}) {
        this.clock = options.clock ?? Date.now;
        this.defaultTimeoutMs = options.timeoutMs;
    }
    get pendingCount() {
        return this.pending.size;
    }
    get pendingIds() {
        return [...this.pending.values()].map((entry) => entry.request.id);
    }
    isPending(id) {
        return this.pending.has(responseKey(id));
    }
    register(request, timeoutMs, timeoutKind = 'request') {
        const key = responseKey(request.id);
        if (this.pending.has(key))
            return Promise.reject(new DuplicateRequestIdError(request.id));
        const deadline = timeoutMs ?? this.defaultTimeoutMs;
        return new Promise((resolve, reject) => {
            let timer;
            if (deadline !== undefined && deadline > 0) {
                timer = setTimeout(() => {
                    this.pending.delete(key);
                    reject(new TimeoutError(timeoutKind, deadline, `${request.method} timed out after ${deadline}ms`));
                }, deadline);
                if (typeof timer.unref === 'function')
                    timer.unref();
            }
            this.pending.set(key, {
                request,
                createdAt: this.clock(),
                resolve: (response) => {
                    if (timer !== undefined)
                        clearTimeout(timer);
                    this.pending.delete(key);
                    resolve(response);
                },
                reject: (error) => {
                    if (timer !== undefined)
                        clearTimeout(timer);
                    this.pending.delete(key);
                    reject(error);
                },
                timer,
            });
        });
    }
    handleMessage(message) {
        if (!isResponse(message))
            return;
        const key = responseKey(message.id);
        const entry = this.pending.get(key);
        if (entry === undefined)
            return;
        this.pending.delete(key);
        if (entry.timer !== undefined)
            clearTimeout(entry.timer);
        if (message.error !== undefined) {
            entry.reject(new JsonRpcRemoteError(message.error.code, message.error.message, message.error.data));
        }
        else {
            entry.resolve(message);
        }
    }
    failById(id, error) {
        const key = responseKey(id);
        const entry = this.pending.get(key);
        if (entry === undefined)
            return;
        this.pending.delete(key);
        if (entry.timer !== undefined)
            clearTimeout(entry.timer);
        entry.reject(error);
    }
    failAll(error) {
        const entries = [...this.pending.values()];
        this.pending.clear();
        for (const entry of entries) {
            if (entry.timer !== undefined)
                clearTimeout(entry.timer);
            entry.reject(error);
        }
    }
}
//# sourceMappingURL=multiplexer.js.map