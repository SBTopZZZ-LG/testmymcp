export type ResultType = 'complete' | 'input_required' | string;
/**
 * A server result with a `resultType` discriminator. Absent `resultType`
 * (older servers) is treated as `"complete"` per the spec.
 */
export interface TypedResult {
    resultType: ResultType;
    [key: string]: unknown;
}
export declare function isTaskResult(result: unknown): result is TypedResult;
export declare function normalizeResultType(result: unknown): ResultType;
