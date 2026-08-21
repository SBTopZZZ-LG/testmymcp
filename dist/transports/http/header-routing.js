import { isProtocolVersion } from '../../core/types/protocol.js';
import { LEGACY_LATEST_PROTOCOL_VERSION } from './types.js';
export function isLegacyProtocolVersion(value) {
    return isProtocolVersion(value) && value !== '2026-07-28';
}
/**
 * Extract the routing-relevant headers from an HTTP response, normalising keys
 * and returning single values. `normalize` is supplied by the caller so this
 * module stays independent of the underlying HTTP client's header type.
 */
export function readJsonResponseHeaders(headers, normalize) {
    return {
        protocolVersion: normalize(headers, 'mcp-protocol-version'),
        method: normalize(headers, 'mcp-method'),
        name: normalize(headers, 'mcp-name'),
    };
}
/**
 * Validate the header-routing contract for a single-response HTTP request.
 *
 * @param view            headers extracted from the response.
 * @param requestMethod   the JSON-RPC method that was requested.
 * @param opts            `expectProtocolVersion` (default latest legacy
 *                        2025-11-25) and `requireName` (default true).
 */
export function validateJsonResponseHeaders(view, requestMethod, opts = {}) {
    const issues = [];
    const expectedVersion = opts.expectProtocolVersion ?? (opts.modern ? '2026-07-28' : LEGACY_LATEST_PROTOCOL_VERSION);
    if (view.protocolVersion === undefined || view.protocolVersion.length === 0) {
        issues.push({
            severity: 'warn',
            header: 'MCP-Protocol-Version',
            expected: expectedVersion,
            actual: view.protocolVersion,
            message: 'MCP-Protocol-Version header is missing',
        });
    }
    else if (opts.modern
        ? !isProtocolVersion(view.protocolVersion)
        : !isLegacyProtocolVersion(view.protocolVersion)) {
        issues.push({
            severity: 'warn',
            header: 'MCP-Protocol-Version',
            expected: expectedVersion,
            actual: view.protocolVersion,
            message: opts.modern
                ? `MCP-Protocol-Version is "${view.protocolVersion}", not a known protocol version`
                : `MCP-Protocol-Version is "${view.protocolVersion}", not a known legacy version`,
        });
    }
    if (requestMethod !== undefined && requestMethod.length > 0) {
        if (view.method === undefined || view.method.length === 0) {
            issues.push({
                severity: 'error',
                header: 'Mcp-Method',
                expected: requestMethod,
                actual: view.method,
                message: 'Mcp-Method header is missing; cannot confirm the response is routed for this request',
            });
        }
        else if (view.method !== requestMethod) {
            issues.push({
                severity: 'error',
                header: 'Mcp-Method',
                expected: requestMethod,
                actual: view.method,
                message: `Mcp-Method "${view.method}" does not match the requested method "${requestMethod}"`,
            });
        }
    }
    if (opts.requireName === false) {
        /* name not required */
    }
    else if (view.name === undefined || view.name.length === 0) {
        issues.push({
            severity: 'warn',
            header: 'Mcp-Name',
            expected: '<server name>',
            actual: view.name,
            message: 'Mcp-Name header is missing',
        });
    }
    return { valid: issues.length === 0, issues };
}
/** Build the standard request headers a conforming client should send. */
export function buildRequestHeaders(opts) {
    const headers = {
        'Content-Type': opts.contentType ?? 'application/json',
        Accept: opts.accept ?? 'application/json, text/event-stream',
    };
    if (opts.protocolVersion !== undefined) {
        headers['MCP-Protocol-Version'] = opts.protocolVersion;
    }
    return headers;
}
//# sourceMappingURL=header-routing.js.map