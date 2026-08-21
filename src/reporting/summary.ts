import type {
  FailureLayer,
  TestCategory,
  TestResult,
  TestStatus,
} from '../core/types/test-result.js';

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

export function computeSummary(results: readonly TestResult[]): TestSummary {
  const summary: TestSummary = {
    total: results.length,
    pass: 0,
    fail: 0,
    warn: 0,
    skip: 0,
    byLayer: { transport: 0, jsonrpc: 0, protocol: 0, application: 0 },
    byCategory: {
      connectivity: 0,
      protocol: 0,
      discovery: 0,
      capability: 0,
      behavioral: 0,
      robustness: 0,
      security: 0,
      fuzz: 0,
    },
    byStatus: { pass: 0, fail: 0, warn: 0, skip: 0 },
  };

  for (const result of results) {
    summary.byStatus[result.status] += 1;
    summary.byCategory[result.category] += 1;
    if (result.status === 'fail' && result.error !== undefined) {
      summary.byLayer[result.error.layer] += 1;
    }
  }

  summary.pass = summary.byStatus.pass;
  summary.fail = summary.byStatus.fail;
  summary.warn = summary.byStatus.warn;
  summary.skip = summary.byStatus.skip;

  return summary;
}
