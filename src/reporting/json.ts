import type { TestResult } from '../core/types/test-result.js';
import { type TestSummary, computeSummary } from './summary.js';
import type { ReportOptions } from './types.js';
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

function withOmittedPayloads(result: TestResult): TestResult {
  const { evidence: _evidence, request: _request, response: _response, ...rest } = result;
  return rest;
}

export function buildJsonReport(
  results: readonly TestResult[],
  meta: ReportMeta = {},
  options: ReportOptions = {},
): JsonReport {
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
  const tests = [...results];
  if (options.stripEvidence === true) {
    for (let i = 0; i < tests.length; i += 1) {
      tests[i] = withOmittedPayloads(tests[i] as TestResult);
    }
  }
  return {
    tool: 'testmymcp',
    schemaVersion: '1.0',
    meta,
    summary: computeSummary(results),
    tests,
    errors,
    warnings,
  };
}

export function createJsonReporter(options: ReportOptions = {}): Reporter {
  return {
    format: 'json',
    render: (results, meta) =>
      JSON.stringify(buildJsonReport(results, meta, options), null, 2) + '\n',
  };
}

export const jsonReporter: Reporter = createJsonReporter();
