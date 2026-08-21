import { createIdGenerator } from '../../core/jsonrpc/id.js';
import { createNotification, createRequest, responseKey, } from '../../core/jsonrpc/messages.js';
import { JsonRpcRemoteError, RequestMultiplexer } from '../../core/jsonrpc/multiplexer.js';
import { emptyClientCapabilities } from '../../core/protocol/capabilities.js';
import { parseDiscoverResult, selectSupportedVersion } from './discover.js';
import { buildInputResponse, buildInputRetryParams, isInputRequiredResult, parseInputRequests, parseRequestState, } from './mrtr.js';
import { withRequestMeta } from './request-meta.js';
const MODERN_DEFAULT_VERSION = '2026-07-28';
const DEFAULT_CLIENT_NAME = 'testmymcp';
const DEFAULT_CLIENT_VERSION = '0.1.0';
export class ModernProtocolAdapter {
    era = 'modern';
    mux;
    transport;
    clientInfo;
    clientCapabilities;
    preferVersion;
    requestTimeoutMs;
    discoverTimeoutMs;
    shutdownTimeoutMs;
    idGen;
    trace;
    clock;
    startedAt = new Map();
    autoMrtr;
    lifecycleState = 'created';
    session;
    discovered;
    constructor(options) {
        this.transport = options.transport;
        this.clientInfo = {
            name: options.clientInfo?.name ?? DEFAULT_CLIENT_NAME,
            version: options.clientInfo?.version ?? DEFAULT_CLIENT_VERSION,
        };
        this.clientCapabilities = { ...emptyClientCapabilities(), ...options.clientCapabilities };
        if (options.extensions !== undefined) {
            this.clientCapabilities.extensions = options.extensions;
        }
        this.preferVersion = options.preferVersion ?? MODERN_DEFAULT_VERSION;
        this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
        this.discoverTimeoutMs = options.discoverTimeoutMs ?? 15_000;
        this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
        this.idGen = createIdGenerator(options.idStyle ?? 'mixed');
        this.trace = options.trace;
        this.clock = options.clock ?? Date.now;
        this.autoMrtr = options.autoMrtr ?? true;
        this.mux = new RequestMultiplexer({ timeoutMs: this.requestTimeoutMs, clock: this.clock });
    }
    get state() {
        return this.lifecycleState;
    }
    get discoverResult() {
        return this.discovered;
    }
    async connect() {
        this.setState('connecting');
        await this.transport.start();
        this.setState('connected');
    }
    /**
     * Modern protocol has no `initialize` handshake. This performs the optional
     * `server/discover` RPC to populate the session (supported versions,
     * capabilities, identity). It is safe to call once; it no-ops if already
     * discovered.
     */
    async initialize(_options) {
        if (this.session !== undefined)
            return this.session;
        if (this.state === 'created' || this.state === 'failed') {
            throw new Error(`cannot initialize from state "${this.state}"`);
        }
        this.setState('initializing');
        const discovered = await this.discover();
        this.discovered = discovered;
        const protocolVersion = selectSupportedVersion(discovered.supportedVersions, this.preferVersion);
        if (protocolVersion === undefined) {
            throw new Error(`server/discover returned no supported protocol version (supported: ${JSON.stringify(discovered.supportedVersions)})`);
        }
        this.session = {
            protocolVersion,
            negotiated: protocolVersion !== this.preferVersion,
            claimedVersion: this.preferVersion,
            serverInfo: discovered.serverInfo,
            clientInfo: this.clientInfo,
            serverCapabilities: discovered.capabilities,
        };
        this.setState('operational');
        return this.session;
    }
    async discover() {
        const result = await this.request('server/discover', undefined, this.discoverTimeoutMs);
        return parseDiscoverResult(result);
    }
    request(method, params, timeoutMs) {
        const kind = method.startsWith('tools/') ? 'tool' : 'request';
        return this.rawRequest(this.idGen(), method, params, timeoutMs, kind);
    }
    async rawRequest(id, method, params, timeoutMs, timeoutKind = 'request') {
        const meta = this.buildRequestMeta();
        const modernParams = withRequestMeta(params, meta);
        let attemptId = id;
        let attemptParams = modernParams;
        const maxRetries = 8;
        for (let attempt = 0;; attempt += 1) {
            const result = await this.sendRequest(attemptId, method, attemptParams, timeoutMs, timeoutKind);
            // MRTR: server returned input_required — client must retry with inputResponses.
            if (this.autoMrtr && isInputRequiredResult(result)) {
                const responses = this.collectInputResponses(result);
                const requestState = parseRequestState(result);
                if (attempt >= maxRetries) {
                    throw new JsonRpcRemoteError(-32602, `request could not be completed after ${maxRetries + 1} input responses`, result);
                }
                attemptId = this.idGen();
                attemptParams = buildInputRetryParams(modernParams, responses, requestState);
                continue;
            }
            return result;
        }
    }
    notify(method, params) {
        let notificationParams = params;
        if (this.shouldAttachMeta(method)) {
            notificationParams = withRequestMeta(params, this.buildRequestMeta());
        }
        const notification = createNotification(method, notificationParams);
        this.traceOut(notification);
        return this.send(notification);
    }
    async shutdown() {
        await Promise.race([
            this.transport.stop(),
            new Promise((resolve) => setTimeout(resolve, this.shutdownTimeoutMs)),
        ]);
        this.setState('closed');
    }
    async disconnect() {
        await this.transport.stop();
        if (this.state !== 'closed')
            this.setState('closed');
    }
    /**
     * Open a `subscriptions/listen` stream (modern). Requires the transport to
     * support long-lived listen streams. Collects notifications (ack + change
     * notifications) into the returned subscription handle until the caller
     * cancels or the server closes the stream.
     */
    subscribe(filter) {
        const listen = this.transport.listen;
        if (typeof listen !== 'function') {
            throw new Error('transport does not support subscriptions/listen');
        }
        const id = this.idGen();
        const params = withRequestMeta(filter, this.buildRequestMeta());
        const request = createRequest(id, 'subscriptions/listen', params);
        const stream = listen.call(this.transport, request);
        const subscription = new ModernSubscription(id);
        stream.onFrame((message) => subscription.push(message));
        void stream.closed.then(() => subscription.close());
        subscription._cancel = () => stream.cancel();
        return subscription;
    }
    /** Collect `inputResponses` for the requests surfaced by an input_required result. */
    collectInputResponses(result) {
        const requests = parseInputRequests(result);
        const responses = {};
        if (requests === undefined)
            return responses;
        for (const [key, raw] of Object.entries(requests)) {
            const request = raw;
            const method = typeof request.method === 'string' ? request.method : undefined;
            const params = (request.params ?? {});
            responses[key] = buildInputResponse(method, params);
        }
        return responses;
    }
    sendRequest(id, method, params, timeoutMs, timeoutKind) {
        const request = createRequest(id, method, params);
        this.traceOut(request);
        const registered = this.mux.register(request, timeoutMs, timeoutKind);
        return (async () => {
            try {
                await this.send(request);
            }
            catch (error) {
                this.mux.failById(request.id, error instanceof Error ? error : new Error(String(error)));
                await registered.catch(() => { });
                throw error;
            }
            const response = await registered;
            this.traceIn(response, request.id);
            if (response.error !== undefined) {
                throw new JsonRpcRemoteError(response.error.code, response.error.message, response.error.data);
            }
            return response.result;
        })();
    }
    buildRequestMeta() {
        return {
            protocolVersion: this.session?.protocolVersion ?? this.preferVersion,
            clientInfo: this.clientInfo,
            clientCapabilities: this.clientCapabilities,
        };
    }
    /**
     * Register discovered tool input schemas so `tools/call` can mirror
     * `x-mcp-header`-annotated parameters into `Mcp-Param-*` headers. No-op on
     * transports that do not support header mirroring.
     */
    setToolSchemas(tools) {
        const setter = this.transport
            .setToolInputSchemas;
        if (typeof setter === 'function')
            setter.call(this.transport, tools);
    }
    // ---- Tasks extension (io.modelcontextprotocol/tasks) ----
    async tasksGet(taskId, timeoutMs) {
        return (await this.request('tasks/get', { taskId }, timeoutMs));
    }
    async tasksUpdate(taskId, inputResponses, timeoutMs) {
        return (await this.request('tasks/update', { taskId, inputResponses }, timeoutMs));
    }
    async tasksCancel(taskId, timeoutMs) {
        return (await this.request('tasks/cancel', { taskId }, timeoutMs));
    }
    /**
     * Poll a task to completion following the Tasks extension protocol. Starts
     * from the `CreateTaskResult` returned by the originating request, then loops
     * `tasks/get` until a terminal status (completed/failed/cancelled). If a poll
     * returns `input_required`, the tester answers via `tasks/update`. Bounded by
     * `maxPollMs` (default `requestTimeoutMs`) and each `pollIntervalMs`.
     */
    async pollTask(taskId, options) {
        const maxPollMs = options?.maxPollMs ?? this.requestTimeoutMs;
        const deadline = this.clock() + maxPollMs;
        let status = await this.tasksGet(taskId);
        for (;;) {
            const state = typeof status.status === 'string' ? status.status : undefined;
            if (state === 'completed' || state === 'failed' || state === 'cancelled') {
                return status;
            }
            if (state === 'input_required') {
                const responses = this.collectInputResponses(status);
                status = await this.tasksUpdate(taskId, responses);
                continue;
            }
            // working / unknown non-terminal — wait and re-poll.
            const interval = options?.pollIntervalMs ??
                (typeof status.pollIntervalMs === 'number' ? status.pollIntervalMs : 200);
            if (this.clock() + interval > deadline) {
                throw new JsonRpcRemoteError(-32602, `task ${taskId} did not reach a terminal status within ${maxPollMs}ms`, status);
            }
            await new Promise((resolve) => setTimeout(resolve, interval));
            status = await this.tasksGet(taskId);
        }
    }
    shouldAttachMeta(method) {
        // The modern protocol carries protocol metadata on every request; the
        // only client-sent notification is notifications/cancelled (stdio).
        return method !== 'notifications/shutdown';
    }
    setState(next) {
        this.lifecycleState = next;
    }
    send(message) {
        return this.transport.send(message);
    }
    traceOut(message) {
        if (this.trace === undefined)
            return;
        const record = message;
        const key = typeof record.id === 'number' || typeof record.id === 'string'
            ? responseKey(record.id)
            : undefined;
        const now = this.clock();
        if (key !== undefined)
            this.startedAt.set(key, now);
        this.trace.add({
            direction: 'out',
            kind: 'id' in record && key !== undefined ? 'request' : 'notification',
            transport: this.transport.kind,
            method: typeof record.method === 'string' ? record.method : undefined,
            requestId: key !== undefined ? record.id : undefined,
            payload: record.params ?? message,
            timestamp: now,
        });
    }
    traceIn(response, requestId) {
        if (this.trace === undefined)
            return;
        const key = responseKey(requestId);
        const started = this.startedAt.get(key);
        this.startedAt.delete(key);
        this.trace.add({
            direction: 'in',
            kind: 'response',
            transport: this.transport.kind,
            requestId,
            latencyMs: started !== undefined ? this.clock() - started : undefined,
            status: response.error !== undefined ? `error ${response.error.code}` : 'ok',
            timestamp: this.clock(),
        });
    }
}
export function createModernProtocolAdapter(options) {
    return new ModernProtocolAdapter(options);
}
/**
 * Client-side handle for a `subscriptions/listen` stream. Collects the
 * acknowledged notification and subsequent change notifications into `events`,
 * keyed by their `io.modelcontextprotocol/subscriptionId` in `_meta` when present.
 */
export class ModernSubscription {
    id;
    list = [];
    closedFlag = false;
    resolveClosed;
    closePromise;
    _cancel;
    constructor(id) {
        this.id = id;
        this.closePromise = new Promise((resolve) => {
            this.resolveClosed = resolve;
        });
    }
    get closed() {
        return this.closePromise;
    }
    get isClosed() {
        return this.closedFlag;
    }
    /** All JSON-RPC messages received so far on the stream. */
    get events() {
        return this.list;
    }
    /** Change notifications (i.e. everything after the first/acknowledged frame). */
    get notifications() {
        const out = [];
        for (const event of this.list) {
            const message = event;
            if (typeof message.method !== 'string')
                continue;
            const params = message.params;
            const meta = (params?._meta ?? {});
            out.push({
                method: message.method,
                params,
                subscriptionId: meta['io.modelcontextprotocol/subscriptionId'],
            });
        }
        return out;
    }
    push(message) {
        this.list.push(message);
    }
    close() {
        if (this.closedFlag)
            return;
        this.closedFlag = true;
        this.resolveClosed?.();
    }
    async cancel() {
        if (this._cancel !== undefined)
            await this._cancel();
        this.close();
    }
}
//# sourceMappingURL=adapter.js.map