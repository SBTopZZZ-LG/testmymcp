import { isNotification, isRequest, isResponse } from '../../core/jsonrpc/messages.js';
import { normalizeHeader, postJson } from './client.js';
import { buildRequestHeaders, readJsonResponseHeaders, validateJsonResponseHeaders, } from './header-routing.js';
import { SseParser } from './sse.js';
import { HTTP_CONTENT_TYPES } from './types.js';
import { buildMcpParamHeaders } from './x-mcp-header.js';
/**
 * Streamable-HTTP transport.
 *
 * Session lifecycle: the `Mcp-Session-Id` returned on the first response
 * (typically `initialize`) is captured and echoed on every subsequent request,
 * which is the only piece of session state the transport must own (the adapter
 * correlates JSON-RPC responses by id through its multiplexer).
 */
export class StreamableHttpTransport {
    kind = 'streamable-http';
    observer;
    options;
    sessionValue;
    started = false;
    stopping = false;
    issues = [];
    lastMethod;
    toolInputSchemas = new Map();
    constructor(options) {
        this.options = options;
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
    get headerIssues() {
        return this.issues;
    }
    get lastRequestMethod() {
        return this.lastMethod;
    }
    /** Register discovered tool input schemas so `tools/call` can mirror `Mcp-Param-*`. */
    setToolInputSchemas(schemas) {
        this.toolInputSchemas = new Map();
        for (const tool of schemas) {
            if (tool.name !== undefined && tool.inputSchema !== undefined)
                this.toolInputSchemas.set(tool.name, tool.inputSchema);
        }
    }
    isOpen() {
        return this.started && !this.stopping;
    }
    async start() {
        if (this.started)
            throw new Error('streamable HTTP transport already started');
        this.started = true;
        this.stopping = false;
    }
    async send(message) {
        if (!this.started || this.stopping)
            throw new Error('transport not started');
        const method = extractMethod(message);
        this.lastMethod = method;
        const isModern = this.options.era === 'modern';
        const accept = this.options.accept ?? (isModern ? 'json' : 'json');
        const acceptValue = isModern || accept === 'sse'
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
            if (method !== undefined)
                headers['Mcp-Method'] = method;
            if (name !== undefined)
                headers['Mcp-Name'] = name;
            // Mirror x-mcp-header-tagged tool parameters into Mcp-Param-{Name} headers.
            if (method === 'tools/call') {
                const callParams = message.params;
                const toolName = typeof callParams?.name === 'string' ? callParams.name : undefined;
                if (toolName !== undefined) {
                    const schema = this.toolInputSchemas.get(toolName);
                    if (schema !== undefined) {
                        const mirrored = buildMcpParamHeaders(schema, callParams?.arguments);
                        for (const [key, value] of Object.entries(mirrored))
                            headers[key] = value;
                    }
                }
            }
        }
        else if (this.sessionValue !== undefined) {
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
            if (sessionId !== undefined && sessionId.length > 0)
                this.sessionValue = sessionId;
        }
        if (result.statusCode < 200 || result.statusCode >= 300) {
            const text = await readText(result).catch(() => '');
            this.observer?.onError?.(new Error(`server returned HTTP ${result.statusCode} (${result.statusText})`));
            throw new Error(`server returned HTTP ${result.statusCode} (${result.statusText}): ${text || 'no response body'}`);
        }
        if (method !== undefined && (this.options.validateHeaders ?? true) && !result.isEventStream) {
            const view = readJsonResponseHeaders(result.headers, normalizeHeader);
            const outcome = validateJsonResponseHeaders({ protocolVersion: view.protocolVersion, method: view.method, name: view.name }, method, { expectProtocolVersion: this.options.protocolVersion, modern: isModern });
            this.issues = [...outcome.issues];
        }
        else {
            this.issues = [];
        }
        if (result.isEventStream) {
            await this.consumeEventStream(result);
            return;
        }
        const payload = await result.json().catch(() => undefined);
        this.dispatchPayload(payload);
    }
    async stop() {
        if (!this.started)
            return;
        this.stopping = true;
        this.started = false;
        // Abort any active listen streams.
        for (const stream of this.activeStreams)
            void stream.cancel();
        this.activeStreams.clear();
    }
    activeStreams = new Set();
    /**
     * Open a `subscriptions/listen` stream. Sends the request via POST, keeps the
     * SSE response stream open, and forwards every parsed JSON-RPC message
     * (ack + notifications) to the observer until the stream ends or the
     * subscription is cancelled. The request must be a JSON-RPC request with an id.
     */
    listen(message) {
        const method = extractMethod(message);
        const id = message.id;
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
            if (method !== undefined)
                headers['Mcp-Method'] = method;
        }
        else if (this.sessionValue !== undefined) {
            headers['Mcp-Session-Id'] = this.sessionValue;
        }
        const stream = new ListenStreamImpl(id);
        this.activeStreams.add(stream);
        void (async () => {
            try {
                let result;
                try {
                    result = await postJson(this.options.url, {
                        url: this.options.url,
                        method: 'POST',
                        headers,
                        body: message,
                        auth: this.options.auth,
                        timeoutMs: this.options.requestTimeoutMs,
                    });
                }
                catch (error) {
                    throw error;
                }
                if (result.statusCode < 200 || result.statusCode >= 300) {
                    const text = await readText(result).catch(() => '');
                    this.observer?.onError?.(new Error(`server returned HTTP ${result.statusCode} (${result.statusText})`));
                    stream.fail(new Error(`server returned HTTP ${result.statusCode} (${result.statusText}): ${text || 'no response body'}`));
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
            }
            catch (error) {
                stream.fail(error instanceof Error ? error : new Error(String(error)));
            }
        })();
        return stream;
    }
    consumeOpenStream(result, stream) {
        const parser = new SseParser({
            maxBytes: this.options.maxEventBytes,
            maxEventBytes: this.options.maxEventBytes,
        });
        const body = result.stream();
        const finish = () => {
            if (stream.isClosed())
                return;
            stream.close();
        };
        const onChunk = (chunk) => {
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
            }
            catch {
                /* ignore */
            }
            finish();
        });
    }
    handleOpenFrame(frame, stream) {
        if (frame.event !== undefined && frame.event !== 'message')
            return;
        if (frame.data.length === 0)
            return;
        let payload;
        try {
            payload = JSON.parse(frame.data);
        }
        catch {
            this.observer?.onGarbage?.(frame.data);
            return;
        }
        this.dispatchPayload(payload);
        stream.emit(payload);
    }
    /** Routes a parsed payload to the observer; returns true when a JSON-RPC response was delivered. */
    dispatchPayload(payload) {
        if (payload === null || payload === undefined)
            return false; // notification with no reply
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
    async consumeEventStream(result) {
        const parser = new SseParser({
            maxBytes: this.options.maxEventBytes,
            maxEventBytes: this.options.maxEventBytes,
        });
        const body = result.stream();
        await new Promise((resolve) => {
            let settled = false;
            let finish = () => { };
            const guard = setTimeout(() => finish(), this.options.requestTimeoutMs ?? 30_000);
            guard.unref?.();
            finish = () => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(guard);
                try {
                    body.destroy();
                }
                catch {
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
                    if (this.handleSseFrame(event.event))
                        responseDelivered = true;
                }
                // The multiplexer resolves once the matching response arrives; stop
                // reading an SSE stream that the server may keep open in the meantime.
                if (responseDelivered)
                    finish();
            });
            body.on('end', finish);
            body.on('error', finish);
        });
    }
    /** Returns true iff the frame carried a JSON-RPC response. */
    handleSseFrame(frame) {
        if (frame.event !== undefined && frame.event !== 'message')
            return false;
        if (frame.data.length === 0)
            return false;
        let payload;
        try {
            payload = JSON.parse(frame.data);
        }
        catch {
            this.observer?.onGarbage?.(frame.data);
            return false;
        }
        return this.dispatchPayload(payload);
    }
}
function extractMethod(message) {
    if (typeof message !== 'object' || message === null)
        return undefined;
    const method = message.method;
    return typeof method === 'string' ? method : undefined;
}
/**
 * Extract the `Mcp-Name` header source: `params.name` (tools/call, prompts/get)
 * or `params.uri` (resources/read). Values that are not plain ASCII are
 * Base64-encoded with the `=?base64?...?=` sentinel format per the spec.
 */
function extractRequestName(message) {
    if (typeof message !== 'object' || message === null)
        return undefined;
    const params = message.params;
    if (params === null || typeof params !== 'object')
        return undefined;
    const method = extractMethod(message);
    const raw = method === 'resources/read' ? params.uri : params.name;
    if (raw === undefined || raw === null)
        return undefined;
    const value = String(raw);
    return encodeHeaderValue(value);
}
function isPlainAscii(value) {
    return /^[\x20-\x7E]*$/.test(value) && value === value.trim();
}
function encodeHeaderValue(value) {
    // Plain ASCII, no surrounding whitespace, and not already a sentinel -> as-is.
    if (isPlainAscii(value) && !/^=\?base64\?/.test(value))
        return value;
    return `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}
function readText(result) {
    return result.text();
}
function safeStringify(value) {
    try {
        return typeof value === 'string' ? value : JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function isJsonRpcId(value) {
    return typeof value === 'number' || typeof value === 'string';
}
class ListenStreamImpl {
    id;
    settled = false;
    cancelHandler;
    resolveClosed = () => { };
    closed;
    events = [];
    frameHandlers = [];
    constructor(id) {
        this.id = id;
        this.closed = new Promise((resolve) => {
            this.resolveClosed = resolve;
        });
    }
    isClosed() {
        return this.settled;
    }
    /** Record a parsed JSON-RPC message and notify subscribers. */
    onFrame(handler) {
        this.frameHandlers.push(handler);
        for (const event of this.events)
            handler(event);
    }
    emit(message) {
        this.events.push(message);
        for (const handler of this.frameHandlers)
            handler(message);
    }
    onCancel(handler) {
        this.cancelHandler = handler;
    }
    close() {
        if (this.settled)
            return;
        this.settled = true;
        this.resolveClosed();
    }
    fail(_error) {
        this.settled = true;
        this.resolveClosed();
    }
    async cancel() {
        if (this.settled)
            return;
        this.cancelHandler?.();
        this.close();
    }
}
//# sourceMappingURL=streamable-http-transport.js.map