import { describe, expect, it } from 'vitest';

import { TestLevel, type TestResult } from '../../src/core/types/test-result.js';
import { renderTerminal } from '../../src/reporting/terminal.js';

function result(partial: Partial<TestResult>): TestResult {
  return {
    id: 'initialize negotiation',
    category: 'protocol',
    level: TestLevel.Protocol,
    status: 'pass',
    severity: 'info',
    durationMs: 1200,
    ...partial,
  };
}

describe('renderTerminal', () => {
  it('renders a verdict and status lines', () => {
    const output = renderTerminal(
      [
        result({}),
        result({
          id: 'spawn server',
          category: 'connectivity',
          status: 'fail',
          severity: 'high',
          error: { layer: 'transport', type: 'spawn', message: 'ENOENT' },
          durationMs: 3,
        }),
        result({ id: 'ping', status: 'warn', warnings: ['slow'], durationMs: 900 }),
        result({ id: 'fuzz tier', status: 'skip', category: 'fuzz', level: TestLevel.Fuzz }),
      ],
      { protocol: '2026-07-28', protocolEra: 'modern', transport: 'stdio', durationMs: 42 },
    );

    expect(output).toContain('✓');
    expect(output).toContain('✗');
    expect(output).toContain('⚠');
    expect(output).toContain('–');
    expect(output).toContain('Verdict: FAIL');
    expect(output).toContain('transport');
    expect(output).toContain('Protocol 2026-07-28 (modern)');
    expect(output).toContain('ENOENT');
  });

  it('marks the verdict as PASS when there are no failures', () => {
    const output = renderTerminal([result({})]);
    expect(output).toContain('Verdict: PASS');
  });

  it('marks the verdict as WARN when there are only warnings', () => {
    const output = renderTerminal([result({ status: 'warn', warnings: ['flaky'] })]);
    expect(output).toContain('Verdict: WARN');
  });
});
