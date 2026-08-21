import { describe, expect, it } from 'vitest';

import { TestLevel, type TestResult } from '../../src/core/types/test-result.js';
import { computeSummary } from '../../src/reporting/summary.js';

function result(partial: Partial<TestResult>): TestResult {
  return {
    id: 't',
    category: 'protocol',
    level: TestLevel.Protocol,
    status: 'pass',
    severity: 'info',
    durationMs: 1,
    ...partial,
  };
}

describe('computeSummary', () => {
  it('counts statuses, categories, and failure layers', () => {
    const results = [
      result({ status: 'pass' }),
      result({
        status: 'fail',
        category: 'connectivity',
        error: { layer: 'transport', type: 'spawn', message: 'no' },
      }),
      result({
        status: 'fail',
        category: 'capability',
        error: { layer: 'application', type: 'tool', message: 'nope' },
      }),
      result({ status: 'warn', warnings: ['slow'], category: 'discovery' }),
      result({ status: 'skip' }),
    ];
    const summary = computeSummary(results);
    expect(summary.total).toBe(5);
    expect(summary.pass).toBe(1);
    expect(summary.fail).toBe(2);
    expect(summary.warn).toBe(1);
    expect(summary.skip).toBe(1);
    expect(summary.byLayer).toEqual({ transport: 1, jsonrpc: 0, protocol: 0, application: 1 });
    expect(summary.byCategory.discovery).toBe(1);
    expect(summary.byStatus.warn).toBe(1);
  });

  it('handles empty results', () => {
    const summary = computeSummary([]);
    expect(summary.total).toBe(0);
    expect(summary.byLayer).toEqual({ transport: 0, jsonrpc: 0, protocol: 0, application: 0 });
  });
});
