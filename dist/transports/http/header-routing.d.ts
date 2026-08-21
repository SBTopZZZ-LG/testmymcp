/**
 * Validation of the MCP "header routing" contract as exercised by the
 * streamable-HTTP transport. Per the spec, a server returning a single
 * JSON-RPC message in an `application/json` response body must also reflect
 * routing metadata in headers:
 *
 *  - `MCP-Protocol-Version`: the negotiated protocol version.
 *  - `Mcp-Method`: the JSON-RPC method this response answers.
 *  - `Mcp-Name`: the logical server/persona name.
 *
 * These helpers return typed outcomes so transports/test-suites can turn a
 * violation into a warning or an error without coupling to HTTP specifics.
 */
export interface HeaderIssue {
    readonly severity: 'error' | 'warn';
    readonly header: string;
    readonly expected: string | undefined;
    readonly actual: string | undefined;
    readonly message: string;
}
export interface HeaderValidationResult {
    readonly valid: boolean;
    readonly issues: readonly HeaderIssue[];
}
export interface JsonResponseHeaderView {
    readonly protocolVersion: string | undefined;
    readonly method: string | undefined;
    readonly name: string | undefined;
}
export declare function isLegacyProtocolVersion(value: string): boolean;
/**
 * Extract the routing-relevant headers from an HTTP response, normalising keys
 * and returning single values. `normalize` is supplied by the caller so this
 * module stays independent of the underlying HTTP client's header type.
 */
export declare function readJsonResponseHeaders(headers: unknown, normalize: (headers: unknown, name: string) => string | undefined): JsonResponseHeaderView;
/**
 * Validate the header-routing contract for a single-response HTTP request.
 *
 * @param view            headers extracted from the response.
 * @param requestMethod   the JSON-RPC method that was requested.
 * @param opts            `expectProtocolVersion` (default latest legacy
 *                        2025-11-25) and `requireName` (default true).
 */
export declare function validateJsonResponseHeaders(view: JsonResponseHeaderView, requestMethod: string | undefined, opts?: {
    expectProtocolVersion?: string;
    requireName?: boolean;
    /** When true, treats `2026-07-28` as a valid protocol version (modern era). */
    modern?: boolean;
}): HeaderValidationResult;
/** Build the standard request headers a conforming client should send. */
export declare function buildRequestHeaders(opts: {
    contentType?: string;
    accept?: string;
    protocolVersion?: string;
}): Record<string, string>;
