import type { TestResult } from '../core/types/test-result.js';
import { type TestSummary } from './summary.js';
import type { ReportMeta, Reporter } from './types.js';
export interface JsonReport {
    tool: 'testmymcp';
    schemaVersion: '1.0';
    meta: ReportMeta;
    summary: TestSummary;
    tests: TestResult[];
    errors: string[];
    warnings: string[];
}
export declare function buildJsonReport(results: readonly TestResult[], meta?: ReportMeta): JsonReport;
export declare const jsonReporter: Reporter;
