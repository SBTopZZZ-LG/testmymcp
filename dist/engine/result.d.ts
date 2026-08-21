import type { FailureLayer, TestCategory, TestLevel, TestResult } from '../core/types/test-result.js';
export declare function resolveErrorLayer(error: unknown, method: string | undefined): FailureLayer;
export interface ResultExtras {
    protocol?: TestResult['protocol'];
    protocolEra?: TestResult['protocolEra'];
    transport?: TestResult['transport'];
    evidence?: unknown;
    warnings?: string[];
    durationMs?: number;
    request?: TestResult['request'];
    response?: TestResult['response'];
    error?: TestResult['error'];
}
export declare function pass(id: string, category: TestCategory, level: TestLevel, extras?: ResultExtras): TestResult;
export declare function warn(id: string, category: TestCategory, level: TestLevel, message: string, extras?: ResultExtras): TestResult;
export declare function skip(id: string, category: TestCategory, level: TestLevel, reason: string, extras?: ResultExtras): TestResult;
export declare function fail(id: string, category: TestCategory, level: TestLevel, layer: FailureLayer, type: string, message: string, extras?: ResultExtras): TestResult;
export declare function fromError(id: string, category: TestCategory, level: TestLevel, error: unknown, layer?: FailureLayer, extras?: ResultExtras): TestResult;
