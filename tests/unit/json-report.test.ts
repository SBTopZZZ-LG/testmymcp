import { describe, expect, it } from 'vitest';

import { TestLevel, type TestResult } from '../../src/core/types/test-result.js';
import { createReporter } from '../../src/reporting/index.js';
import { buildJsonReport, jsonReporter } from '../../src/reporting/json.js';

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
    const report = buildJsonReport(results, {
      protocol: '2026-07-28',
      protocolEra: 'modern',
      transport: 'stdio',
    });
    expect(report.tool).toBe('testmymcp');
    expect(report.meta.protocol).toBe('2026-07-28');
    expect(report.summary.fail).toBe(1);
    expect(report.summary.byLayer.application).toBe(1);
    expect(report.tests).toHaveLength(2);
    expect(report.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('division by zero')]),
    );
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

  it('omits embedded payloads from the JSON report when stripEvidence is set', () => {
    const heavy = result({
      id: 'tools/call get_symbols',
      category: 'capability',
      level: TestLevel.Capability,
      status: 'pass',
      evidence: { content: [{ type: 'text', text: 'x'.repeat(1024 * 1024) }] },
      request: { id: 'r1', timestamp: 1, direction: 'out', kind: 'request', method: 'tools/call' },
      response: { id: 'r2', timestamp: 2, direction: 'in', kind: 'response', method: 'tools/call' },
    });
    const full = buildJsonReport([heavy]);
    expect(full.tests[0]?.evidence).toBeDefined();
    expect(full.tests[0]?.request).toBeDefined();
    expect(full.tests[0]?.response).toBeDefined();

    const compact = buildJsonReport([heavy], {}, { stripEvidence: true });
    expect(compact.tests[0]).not.toHaveProperty('evidence');
    expect(compact.tests[0]).not.toHaveProperty('request');
    expect(compact.tests[0]).not.toHaveProperty('response');
    expect(compact.tests[0]).toMatchObject({ id: 'tools/call get_symbols', status: 'pass' });
  });

  it('applies stripEvidence through the reporter factory', () => {
    const heavy = result({
      id: 'tools/call get_symbols',
      status: 'fail',
      error: { layer: 'transport', type: 'line-size', message: 'too large' },
      evidence: { blob: 'y'.repeat(2048) },
    });
    const compact = createReporter('json', { stripEvidence: true }).render([heavy]);
    const parsed = JSON.parse(compact) as ReturnType<typeof buildJsonReport>;
    expect(parsed.tests[0]).not.toHaveProperty('evidence');
    expect(parsed.errors).toEqual([expect.stringContaining('too large')]);
  });
});
