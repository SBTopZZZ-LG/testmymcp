import { isNotification, isRequest, isResponse } from '../../core/jsonrpc/messages.js';
import { postJson } from './client.js';
import { SseParser } from './sse.js';
import { HTTP_CONTENT_TYPES } from './types.js';
/**
 * Legacy SSE transport.
 *
 * Lifecycle: `start()` opens a long-lived `GET` SSE stream (mirroring
 * `GET /sse`), learns the `POST` messages endpoint from the `endpoint`
 * handshake event, then keeps consuming the stream in the background. Each
 * `send()` POSTs a JSON-RPC message to the messages endpoint; the corresponding
 * response arrives later as an `event: message` frame on the stream and is
 * routed to the observer (the adapter's multiplexer correlates it by id).
 */
export class LegacySseTransport {
    kind = 'legacy-sse';
    observer;
    options;
    messagesValue;
    sessionValue;
    body;
    started = false;
    stopping = false;
    constructor(options) {
        this.options = options;
        this.messagesValue = options.messagesUrl;
    }
    get stderrLines() {
        return [];
    }
    get exited() {
        return null;
    }
    get sessionId() {
        return this.sessionValue;
    }
    get messagesUrl() {
        return this.messagesValue;
    }
    isOpen() {
        return this.started && !this.stopping;
    }
    async start() {
        if (this.started)
            throw new Error('legacy SSE transport already started');
        const result = await postJson(this.options.url, {
            url: this.options.url,
            method: 'GET',
            headers: { Accept: HTTP_CONTENT_TYPES.SSE },
            auth: this.options.auth,
            timeoutMs: this.options.requestTimeoutMs,
        });
        if (result.statusCode < 200 || result.statusCode >= 300) {
            const text = await result.text().catch(() => '');
            throw new Error(`server returned HTTP ${result.statusCode} (${result.statusText}) opening SSE stream: ${text || 'no body'}`);
        }
        if (!result.isEventStream) {
            throw new Error('server did not respond with a text/event-stream body to the SSE endpoint');
        }
        this.started = true;
        this.stopping = false;
        this.body = result.stream();
        this.consumeStream();
        await this.waitForMessagesUrl(this.options.requestTimeoutMs ?? 15_000);
    }
    async send(message) {
        if (!this.started || this.stopping)
            throw new Error('transport not started');
        const target = this.resolveMessagesUrl();
        if (target === null) {
            throw new Error('legacy SSE messages endpoint not yet discovered');
        }
        const result = await postJson(target, {
            url: target,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: message,
            auth: this.options.auth,
            timeoutMs: this.options.requestTimeoutMs,
        });
        // The JSON-RPC reply is delivered over the long-lived SSE stream, not in
        // this POST response. Surface only hard transport failures here.
        if (result.statusCode >= 500) {
            throw new Error(`messages endpoint returned HTTP ${result.statusCode} (${result.statusText})`);
        }
    }
    async stop() {
        if (!this.started)
            return;
        this.stopping = true;
        this.started = false;
        try {
            this.body?.destroy();
        }
        catch {
            /* ignore */
        }
        this.body = undefined;
    }
    resolveMessagesUrl() {
        const target = this.messagesValue;
        if (target === undefined || target.length === 0)
            return null;
        try {
            return new URL(target, this.options.url).toString();
        }
        catch {
            return target;
        }
    }
    waitForMessagesUrl(timeoutMs) {
        if (this.messagesValue !== undefined && this.messagesValue.length > 0) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('legacy SSE endpoint event (messages url) not received in time'));
            }, timeoutMs);
            timer.unref?.();
            const interval = setInterval(() => {
                if (this.messagesValue !== undefined && this.messagesValue.length > 0) {
                    clearTimeout(timer);
                    clearInterval(interval);
                    resolve();
                }
            }, 10);
            const body = this.body;
            body?.once('end', () => {
                clearTimeout(timer);
                clearInterval(interval);
                reject(new Error('SSE stream closed before the messages endpoint was announced'));
            });
        });
    }
    consumeStream() {
        const body = this.body;
        if (body === undefined)
            return;
        const parser = new SseParser({ maxEventBytes: this.options.maxEventBytes });
        body.on('data', (chunk) => {
            for (const event of parser.push(chunk)) {
                if (event.kind === 'error') {
                    this.observer?.onError?.(new Error(event.message));
                    continue;
                }
                this.handleStreamEvent(event.event);
            }
        });
        body.on('end', () => {
            this.observer?.onExit?.({ code: null, signal: null });
        });
        body.on('error', (error) => this.observer?.onError?.(error));
    }
    handleStreamEvent(event) {
        if (event.event === 'endpoint') {
            this.messagesValue = event.data || this.messagesValue;
            this.sessionValue = extractSessionId(event.data);
            return;
        }
        if (event.event !== undefined && event.event !== 'message')
            return;
        if (event.data.length === 0)
            return;
        let payload;
        try {
            payload = JSON.parse(event.data);
        }
        catch {
            this.observer?.onGarbage?.(event.data);
            return;
        }
        if (isResponse(payload) || isRequest(payload) || isNotification(payload)) {
            this.observer?.onMessage?.(payload);
        }
        else {
            this.observer?.onGarbage?.(event.data);
        }
    }
}
function extractSessionId(endpointData) {
    if (!endpointData.includes('sessionId'))
        return undefined;
    try {
        const query = endpointData.includes('?')
            ? endpointData.slice(endpointData.indexOf('?') + 1)
            : '';
        const params = new URLSearchParams(query);
        const value = params.get('sessionId');
        return value === null ? undefined : value;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=legacy-sse-transport.js.map