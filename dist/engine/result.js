import { JsonRpcRemoteError } from '../core/jsonrpc/multiplexer.js';
import { TimeoutError } from '../core/timeouts/deadline.js';
export function resolveErrorLayer(error, method) {
    if (error instanceof TimeoutError)
        return 'transport';
    if (error instanceof JsonRpcRemoteError) {
        // Modern spec error codes are protocol-level regardless of method.
        if (error.code === -32020 || error.code === -32021 || error.code === -32022)
            return 'protocol';
        if (method !== undefined && method.startsWith('tools/'))
            return 'application';
        return 'protocol';
    }
    return 'transport';
}
function base(id, category, level, status, severity, extras = {}) {
    return {
        id,
        category,
        level,
        status,
        severity,
        durationMs: extras.durationMs ?? 0,
        protocol: extras.protocol,
        protocolEra: extras.protocolEra,
        transport: extras.transport,
        evidence: extras.evidence,
        warnings: extras.warnings,
        request: extras.request,
        response: extras.response,
        error: extras.error,
    };
}
export function pass(id, category, level, extras = {}) {
    return base(id, category, level, 'pass', 'info', extras);
}
export function warn(id, category, level, message, extras = {}) {
    return base(id, category, level, 'warn', 'medium', {
        ...extras,
        warnings: [message, ...(extras.warnings ?? [])],
    });
}
export function skip(id, category, level, reason, extras = {}) {
    return base(id, category, level, 'skip', 'info', {
        ...extras,
        warnings: [reason, ...(extras.warnings ?? [])],
    });
}
export function fail(id, category, level, layer, type, message, extras = {}) {
    return base(id, category, level, 'fail', 'high', {
        ...extras,
        error: { layer, type, message },
    });
}
export function fromError(id, category, level, error, layer = 'protocol', extras = {}) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(id, category, level, layer, error instanceof Error ? error.name : 'Error', message, extras);
}
//# sourceMappingURL=result.js.map