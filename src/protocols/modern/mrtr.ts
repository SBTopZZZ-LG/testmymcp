import { asRecord, isRecord } from './util.js';

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

export function isInputRequiredResult(result: unknown): result is InputRequiredResult {
  const record = asRecord(result);
  if (record === undefined || record.resultType !== 'input_required') return false;
  return (
    (record.inputRequests !== undefined && isRecord(record.inputRequests)) ||
    (record.requestState !== undefined && typeof record.requestState === 'string')
  );
}

export function parseInputRequests(result: unknown): InputRequests | undefined {
  if (!isInputRequiredResult(result)) return undefined;
  return asRecord(result.inputRequests);
}

export function parseRequestState(result: unknown): string | undefined {
  if (!isInputRequiredResult(result)) return undefined;
  return typeof result.requestState === 'string' ? result.requestState : undefined;
}

/**
 * Build the retry params for a modern request that received an
 * `input_required` result. Echoes `requestState` verbatim (when present) and
 * adds `inputResponses`. New JSON-RPC id is the caller's responsibility (MRTR).
 */
export function buildInputRetryParams(
  originalParams: object | undefined,
  inputResponses: InputResponses,
  requestState: string | undefined,
): Record<string, unknown> {
  const base =
    originalParams !== undefined ? { ...(originalParams as Record<string, unknown>) } : {};
  base.inputResponses = inputResponses;
  if (requestState !== undefined) base.requestState = requestState;
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
export function buildInputResponse(
  method: string | undefined,
  params: Record<string, unknown>,
): Record<string, unknown> {
  switch (method) {
    case 'elicitation/create': {
      const schema = (params.requestedSchema ?? params.schema) as
        Record<string, unknown> | undefined;
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

function defaultContentForSchema(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const properties = isRecord(schema?.properties)
    ? (schema?.properties as Record<string, unknown>)
    : undefined;
  if (properties === undefined) return out;
  for (const [key, raw] of Object.entries(properties)) {
    const prop = raw as Record<string, unknown>;
    const type = typeof prop.type === 'string' ? prop.type : undefined;
    if (type === 'boolean') out[key] = true;
    else if (type === 'integer' || type === 'number') out[key] = 0;
    else if (type === 'string') out[key] = '';
    else out[key] = null;
  }
  return out;
}
