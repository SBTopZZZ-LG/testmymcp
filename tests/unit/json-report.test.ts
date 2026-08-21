import { describe, expect, it } from 'vitest';
import { buildJsonReport, jsonReporter } from '../../src/reporting/json.js';
import { createReporter } from '../../src/reporting/index.js';
import { TestLevel, type TestResult } from '../../src/core/types/test-result.js';

function result(partial: Partial<TestResult>): TestResult {
  return {
    id: 'tools/list pagination',
    category: 'discovery',
    level: TestLevel.Discovery,
    status: 'pass',
    severity: 'info',
    durationMs: 8,
    ...partial,
  };
}

describe('buildJsonReport', () => {
  const results = [
    result({}),
    result({
      id: 'tools/call sum',
      category: 'capability',
      level: TestLevel.Capability,
      status: 'fail',
      error: { layer: 'application', type: 'tool', message: 'division by zero' },
      warnings: ['schema unknown'],
    }),
  ];

  it('shapes the report for machine consumers', () => {
    const report = buildJsonReport(results, { protocol: '2026-07-28', protocolEra: 'modern', transport: 'stdio' });
    expect(report.tool).toBe('testmymcp');
    expect(report.meta.protocol).toBe('2026-07-28');
    expect(report.summary.fail).toBe(1);
    expect(report.summary.byLayer.application).toBe(1);
    expect(report.tests).toHaveLength(2);
    expect(report.errors).toEqual(expect.arrayContaining([expect.stringContaining('division by zero')]));
    expect(report.warnings).toEqual(['tools/call sum: schema unknown']);
  });

  it('serializes deterministically through the reporter', () => {
    const output = jsonReporter.render(results, { transport: 'stdio' });
    const parsed = JSON.parse(output) as ReturnType<typeof buildJsonReport>;
    expect(parsed.schemaVersion).toBe('1.0');
    expect(parsed.summary).toEqual(expect.objectContaining({ total: 2 }));
  });

  it('selects the JSON reporter through the factory', () => {
    expect(createReporter('json').format).toBe('json');
    expect(createReporter('terminal').format).toBe('terminal');
  });
});