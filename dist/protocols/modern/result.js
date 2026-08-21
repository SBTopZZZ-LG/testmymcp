import { isRecord } from './util.js';
export function isTaskResult(result) {
    return isRecord(result) && result.resultType === 'task';
}
export function normalizeResultType(result) {
    if (isRecord(result) && typeof result.resultType === 'string')
        return result.resultType;
    return 'complete';
}
//# sourceMappingURL=result.js.map