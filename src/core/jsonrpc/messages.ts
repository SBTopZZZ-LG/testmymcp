export type JsonRpcId = number | string;

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: object;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: object;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasId(value: Record<string, unknown>): boolean {
  return 'id' in value && (typeof value.id === 'number' || typeof value.id === 'string');
}

function hasMethod(
  value: Record<string, unknown>,
): value is Record<string, unknown> & { method: string } {
  return typeof value.method === 'string';
}

export function isRequest(value: unknown): value is JsonRpcRequest {
  return (
    isRecord(value) &&
    value.jsonrpc === '2.0' &&
    hasId(value) &&
    hasMethod(value) &&
    value.result === undefined &&
    value.error === undefined
  );
}

export function isNotification(value: unknown): value is JsonRpcNotification {
  return isRecord(value) && value.jsonrpc === '2.0' && !hasId(value) && hasMethod(value);
}

export function isResponse(value: unknown): value is JsonRpcResponse {
  if (!isRecord(value) || value.jsonrpc !== '2.0' || !hasId(value) || hasMethod(value))
    return false;
  const hasResult = value.result !== undefined;
  const hasError = value.error !== undefined;
  return hasResult !== hasError;
}

export function createRequest(id: JsonRpcId, method: string, params?: object): JsonRpcRequest {
  const request: JsonRpcRequest = { jsonrpc: '2.0', id, method };
  if (params !== undefined) request.params = params;
  return request;
}

export function createNotification(method: string, params?: object): JsonRpcNotification {
  const notification: JsonRpcNotification = { jsonrpc: '2.0', method };
  if (params !== undefined) notification.params = params;
  return notification;
}

export function createResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function createErrorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  const error: JsonRpcErrorObject = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

export function responseKey(id: JsonRpcId): string {
  return typeof id === 'number' ? `n:${id}` : `s:${id}`;
}

export const JSONRPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;
