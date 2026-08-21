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
export declare function isRequest(value: unknown): value is JsonRpcRequest;
export declare function isNotification(value: unknown): value is JsonRpcNotification;
export declare function isResponse(value: unknown): value is JsonRpcResponse;
export declare function createRequest(id: JsonRpcId, method: string, params?: object): JsonRpcRequest;
export declare function createNotification(method: string, params?: object): JsonRpcNotification;
export declare function createResponse(id: JsonRpcId, result: unknown): JsonRpcResponse;
export declare function createErrorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse;
export declare function responseKey(id: JsonRpcId): string;
export declare const JSONRPC_ERROR_CODES: {
    readonly PARSE_ERROR: -32700;
    readonly INVALID_REQUEST: -32600;
    readonly METHOD_NOT_FOUND: -32601;
    readonly INVALID_PARAMS: -32602;
    readonly INTERNAL_ERROR: -32603;
};
