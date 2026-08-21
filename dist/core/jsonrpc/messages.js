function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasId(value) {
    return 'id' in value && (typeof value.id === 'number' || typeof value.id === 'string');
}
function hasMethod(value) {
    return typeof value.method === 'string';
}
export function isRequest(value) {
    return (isRecord(value) &&
        value.jsonrpc === '2.0' &&
        hasId(value) &&
        hasMethod(value) &&
        value.result === undefined &&
        value.error === undefined);
}
export function isNotification(value) {
    return isRecord(value) && value.jsonrpc === '2.0' && !hasId(value) && hasMethod(value);
}
export function isResponse(value) {
    if (!isRecord(value) || value.jsonrpc !== '2.0' || !hasId(value) || hasMethod(value))
        return false;
    const hasResult = value.result !== undefined;
    const hasError = value.error !== undefined;
    return hasResult !== hasError;
}
export function createRequest(id, method, params) {
    const request = { jsonrpc: '2.0', id, method };
    if (params !== undefined)
        request.params = params;
    return request;
}
export function createNotification(method, params) {
    const notification = { jsonrpc: '2.0', method };
    if (params !== undefined)
        notification.params = params;
    return notification;
}
export function createResponse(id, result) {
    return { jsonrpc: '2.0', id, result };
}
export function createErrorResponse(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined)
        error.data = data;
    return { jsonrpc: '2.0', id, error };
}
export function responseKey(id) {
    return typeof id === 'number' ? `n:${id}` : `s:${id}`;
}
export const JSONRPC_ERROR_CODES = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
};
//# sourceMappingURL=messages.js.map