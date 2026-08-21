import type { ToolDefinition } from '../../core/primitives/types.js';
export interface HeaderAnnotation {
    /** The header name portion, e.g. "Region" → `Mcp-Param-Region`. */
    readonly headerName: string;
    /** The chain of `properties` keys leading to the annotated property. */
    readonly path: readonly string[];
    readonly type?: string;
}
export interface ValidateToolHeadersResult {
    readonly valid: boolean;
    readonly reason?: string;
    readonly annotations: readonly HeaderAnnotation[];
}
/**
 * Extract the x-mcp-header annotations from a full inputSchema, tracking each
 * annotated property's full `properties` path so header values can be read from
 * nested call arguments.
 */
export declare function collectXMcpHeaders(inputSchema: unknown): Array<{
    path: string[];
    type: string;
    headerName: string;
}>;
/**
 * Validate a tool's inputSchema for x-mcp-header correctness, per the spec:
 * - every `x-mcp-header` value is a non-empty HTTP field-name token
 * - no CR/LF control chars
 * - case-insensitively unique across the schema
 * - applies only to primitive types (integer/string/boolean, NOT number)
 * - only on statically-reachable properties
 */
export declare function validateToolHeaders(inputSchema: unknown): ValidateToolHeadersResult;
/**
 * Build the `Mcp-Param-{Name}` headers for a `tools/call`. Reads each annotated
 * property value from the call arguments along its `properties` path, applying
 * the value-encoding rules (type conversion + Base64 sentinel for unsafe values).
 * Returns a map of header name → header value (already encoded).
 */
export declare function buildMcpParamHeaders(inputSchema: unknown, argumentsObject: unknown): Record<string, string>;
/**
 * A tool definition is conforming only if its x-mcp-header annotations are
 * valid. Returns the tool unchanged when valid; otherwise returns null and a
 * reason (clients must exclude invalid tools from tools/list).
 */
export declare function sanitizeToolHeaders(tool: ToolDefinition): {
    tool: ToolDefinition;
    valid: boolean;
    reason?: string;
};
