import type { TestResult } from '../core/types/test-result.js';
import type { ReportMeta, Reporter } from './types.js';
import { computeSummary, type TestSummary } from './summary.js';

export interface JsonReport {
  tool: 'testmymcp';
  schemaVersion: '1.0';
  meta: ReportMeta;
  summary: TestSummary;
  tests: TestResult[];
  errors: string[];
  warnings: string[];
}

export function buildJsonReport(results: readonly TestResult[], meta: ReportMeta = {}): JsonReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const result of results) {
    if (result.status === 'fail' && result.error !== undefined) {
      errors.push(
        `${result.id}: [${result.error.layer}] ${result.error.message}${result.error.code !== undefined ? ` (${result.error.code})` : ''}`,
      );
    }
    if (result.warnings !== undefined) {
      warnings.push(...result.warnings.map((warning) => `${result.id}: ${warning}`));
    }
  }
  return {
    tool: 'testmymcp',
    schemaVersion: '1.0',
    meta,
    summary: computeSummary(results),
    tests: [...results],
    errors,
    warnings,
  };
}

export const jsonReporter: Reporter = {
  format: 'json',
  render: (results, meta) => JSON.stringify(buildJsonReport(results, meta), null, 2) + '\n',
};