export interface InputRequiredResult {
    resultType: 'input_required';
    inputRequests?: Record<string, unknown>;
    requestState?: string;
}
export interface InputRequests {
    [key: string]: unknown;
}
export interface InputResponses {
    [key: string]: unknown;
}
export declare function isInputRequiredResult(result: unknown): result is InputRequiredResult;
export declare function parseInputRequests(result: unknown): InputRequests | undefined;
export declare function parseRequestState(result: unknown): string | undefined;
/**
 * Build the retry params for a modern request that received an
 * `input_required` result. Echoes `requestState` verbatim (when present) and
 * adds `inputResponses`. New JSON-RPC id is the caller's responsibility (MRTR).
 */
export declare function buildInputRetryParams(originalParams: object | undefined, inputResponses: InputResponses, requestState: string | undefined): Record<string, unknown>;
/**
 * Build a single input response for one surfaced input request. The shape
 * depends on the request method so the conformance tester answers each input
 * type faithfully instead of blindly echoing `{action:'accept', content:{}}`:
 * - `elicitation/create` → `accept` with sample content from the requested schema
 * - `sampling/createMessage`/`sampling/create` → `accept` with a minimal message
 * - `roots/list` → `accept` with an empty root list
 */
export declare function buildInputResponse(method: string | undefined, params: Record<string, unknown>): Record<string, unknown>;
