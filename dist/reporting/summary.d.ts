import type { FailureLayer, TestCategory, TestResult, TestStatus } from '../core/types/test-result.js';
export interface TestSummary {
    total: number;
    pass: number;
    fail: number;
    warn: number;
    skip: number;
    byLayer: Record<FailureLayer, number>;
    byCategory: Record<TestCategory, number>;
    byStatus: Record<TestStatus, number>;
}
export declare function computeSummary(results: readonly TestResult[]): TestSummary;
