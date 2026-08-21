import { isRecord } from './util.js';

export type ResultType = 'complete' | 'input_required' | string;

/**
 * A server result with a `resultType` discriminator. Absent `resultType`
 * (older servers) is treated as `"complete"` per the spec.
 */
export interface TypedResult {
  resultType: ResultType;
  [key: string]: unknown;
}

export function isTaskResult(result: unknown): result is TypedResult {
  return isRecord(result) && result.resultType === 'task';
}

export function normalizeResultType(result: unknown): ResultType {
  if (isRecord(result) && typeof result.resultType === 'string') return result.resultType;
  return 'complete';
}
