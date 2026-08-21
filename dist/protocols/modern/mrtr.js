import { asRecord, isRecord } from './util.js';
export function isInputRequiredResult(result) {
    const record = asRecord(result);
    if (record === undefined || record.resultType !== 'input_required')
        return false;
    return ((record.inputRequests !== undefined && isRecord(record.inputRequests)) ||
        (record.requestState !== undefined && typeof record.requestState === 'string'));
}
export function parseInputRequests(result) {
    if (!isInputRequiredResult(result))
        return undefined;
    return asRecord(result.inputRequests);
}
export function parseRequestState(result) {
    if (!isInputRequiredResult(result))
        return undefined;
    return typeof result.requestState === 'string' ? result.requestState : undefined;
}
/**
 * Build the retry params for a modern request that received an
 * `input_required` result. Echoes `requestState` verbatim (when present) and
 * adds `inputResponses`. New JSON-RPC id is the caller's responsibility (MRTR).
 */
export function buildInputRetryParams(originalParams, inputResponses, requestState) {
    const base = originalParams !== undefined ? { ...originalParams } : {};
    base.inputResponses = inputResponses;
    if (requestState !== undefined)
        base.requestState = requestState;
    return base;
}
/**
 * Build a single input response for one surfaced input request. The shape
 * depends on the request method so the conformance tester answers each input
 * type faithfully instead of blindly echoing `{action:'accept', content:{}}`:
 * - `elicitation/create` → `accept` with sample content from the requested schema
 * - `sampling/createMessage`/`sampling/create` → `accept` with a minimal message
 * - `roots/list` → `accept` with an empty root list
 */
export function buildInputResponse(method, params) {
    switch (method) {
        case 'elicitation/create': {
            const schema = (params.requestedSchema ?? params.schema);
            return { action: 'accept', content: defaultContentForSchema(schema) };
        }
        case 'sampling/createMessage':
        case 'sampling/create':
            return { action: 'accept', content: { role: 'user', content: { type: 'text', text: '' } } };
        case 'roots/list':
            return { action: 'accept', roots: [] };
        default:
            return { action: 'accept', content: {} };
    }
}
function defaultContentForSchema(schema) {
    const out = {};
    const properties = isRecord(schema?.properties)
        ? schema?.properties
        : undefined;
    if (properties === undefined)
        return out;
    for (const [key, raw] of Object.entries(properties)) {
        const prop = raw;
        const type = typeof prop.type === 'string' ? prop.type : undefined;
        if (type === 'boolean')
            out[key] = true;
        else if (type === 'integer' || type === 'number')
            out[key] = 0;
        else if (type === 'string')
            out[key] = '';
        else
            out[key] = null;
    }
    return out;
}
//# sourceMappingURL=mrtr.js.map