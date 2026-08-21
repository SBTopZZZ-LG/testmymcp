import type { ToolDefinition } from '../../core/primitives/types.js';

/**
 * Support for the `x-mcp-header` tool-parameter annotation (2026-07-28
 * streamable-HTTP). Servers may annotate a tool parameter's schema with
 * `x-mcp-header: <Name>`; conforming clients must mirror that parameter's value
 * into a `Mcp-Param-{Name}` request header when calling the tool, and must
 * exclude tool definitions whose `x-mcp-header` annotations violate the spec
 * constraints.
 */

const HEADER_NAME_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extract the x-mcp-header annotations from a full inputSchema, tracking each
 * annotated property's full `properties` path so header values can be read from
 * nested call arguments.
 */
export function collectXMcpHeaders(
  inputSchema: unknown,
): Array<{ path: string[]; type: string; headerName: string }> {
  if (!isRecord(inputSchema)) return [];
  const out: Array<{ path: string[]; type: string; headerName: string }> = [];
  const rootType = typeof inputSchema.type === 'string' ? inputSchema.type : undefined;
  const properties = inputSchema.properties;
  if (isRecord(properties)) {
    for (const [key, value] of Object.entries(properties)) {
      collectAnnotationRecursive([String(key)], value, rootType, out);
    }
  }
  return out;
}

function collectAnnotationRecursive(
  path: string[],
  node: unknown,
  parentType: string | undefined,
  out: Array<{ path: string[]; type: string; headerName: string }>,
): void {
  if (!isRecord(node)) return;
  const type = typeof node.type === 'string' ? node.type : parentType;
  if (node['x-mcp-header'] !== undefined) {
    out.push({ path: [...path], type: type ?? '', headerName: String(node['x-mcp-header']) });
  }
  const nested = node.properties;
  if (isRecord(nested)) {
    for (const [nkey, nvalue] of Object.entries(nested)) {
      collectAnnotationRecursive([...path, String(nkey)], nvalue, type, out);
    }
  }
}

const PRIMITIVE = new Set(['integer', 'string', 'boolean']);

/**
 * Validate a tool's inputSchema for x-mcp-header correctness, per the spec:
 * - every `x-mcp-header` value is a non-empty HTTP field-name token
 * - no CR/LF control chars
 * - case-insensitively unique across the schema
 * - applies only to primitive types (integer/string/boolean, NOT number)
 * - only on statically-reachable properties
 */
export function validateToolHeaders(inputSchema: unknown): ValidateToolHeadersResult {
  const annotations = collectXMcpHeaders(inputSchema);
  const issues: string[] = [];
  const seen = new Map<string, string>();

  for (const annotation of annotations) {
    const headerName = annotation.headerName;
    const keyLabel = annotation.path.join('.');
    if (headerName === '') issues.push(`x-mcp-header on "${keyLabel}" is empty`);
    if (!HEADER_NAME_TOKEN.test(headerName))
      issues.push(`x-mcp-header "${headerName}" on "${keyLabel}" is not a valid field-name token`);
    if (/[\r\n]/.test(headerName))
      issues.push(`x-mcp-header on "${keyLabel}" contains control characters`);
    const lower = headerName.toLowerCase();
    if (seen.has(lower) && seen.get(lower) !== keyLabel) {
      issues.push(
        `x-mcp-header "${headerName}" is duplicated (${seen.get(lower)} and ${keyLabel})`,
      );
    }
    seen.set(lower, keyLabel);
    if (!PRIMITIVE.has(annotation.type)) {
      issues.push(
        `x-mcp-header "${headerName}" on "${keyLabel}" applies to non-primitive type "${annotation.type}"`,
      );
    }
  }

  if (issues.length > 0) return { valid: false, reason: issues.join('; '), annotations };
  return { valid: true, annotations };
}

/**
 * Build the `Mcp-Param-{Name}` headers for a `tools/call`. Reads each annotated
 * property value from the call arguments along its `properties` path, applying
 * the value-encoding rules (type conversion + Base64 sentinel for unsafe values).
 * Returns a map of header name → header value (already encoded).
 */
export function buildMcpParamHeaders(
  inputSchema: unknown,
  argumentsObject: unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(inputSchema) || !isRecord(argumentsObject)) return out;
  const validation = validateToolHeaders(inputSchema);
  if (!validation.valid) return out;

  for (const annotation of validation.annotations) {
    // Read the value at the property path.
    let value: unknown = argumentsObject;
    for (const segment of annotation.path) {
      if (!isRecord(value)) {
        value = undefined;
        break;
      }
      value = value[segment];
    }
    if (value === undefined || value === null) {
      // null/absent → omit the header per spec.
      continue;
    }
    const header = `Mcp-Param-${annotation.headerName}`;
    const encoded = encodeParamHeader(annotation.type, value);
    if (encoded !== undefined) out[header] = encoded;
  }
  return out;
}

function encodeParamHeader(type: string | undefined, value: unknown): string | undefined {
  let text: string;
  switch (type) {
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
      text = String(value);
      break;
    case 'boolean':
      text = value === true ? 'true' : value === false ? 'false' : '';
      if (text === '') return undefined;
      break;
    case 'string':
      if (typeof value !== 'string') return undefined;
      text = value;
      break;
    default:
      return undefined;
  }
  return encodeHeaderValue(text);
}

function encodeHeaderValue(value: string): string {
  const plain =
    /^[\x20-\x7E]*$/.test(value) && value === value.trim() && !value.startsWith('=?base64?');
  if (plain) return value;
  return `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/**
 * A tool definition is conforming only if its x-mcp-header annotations are
 * valid. Returns the tool unchanged when valid; otherwise returns null and a
 * reason (clients must exclude invalid tools from tools/list).
 */
export function sanitizeToolHeaders(tool: ToolDefinition): {
  tool: ToolDefinition;
  valid: boolean;
  reason?: string;
} {
  const inputSchema = tool.inputSchema;
  if (inputSchema === undefined) return { tool, valid: true };
  const result = validateToolHeaders(inputSchema);
  if (result.valid) return { tool, valid: true };
  return { tool, valid: false, reason: result.reason };
}
