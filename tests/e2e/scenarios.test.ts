import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { TestResult } from '../src/core/types/test-result.js';
import { type ExpectedStatus, type ScenarioSetup, runScenario } from './run-scenario.js';

interface ManifestExpectation {
  status: ExpectedStatus;
  layer?: string;
  required?: boolean;
}
interface ManifestScenario {
  description?: string;
  fixture: string;
  era: 'legacy' | 'modern';
  transport: 'stdio' | 'streamable-http';
  protocolVersion?: string;
  maxLineBytes?: number;
  options?: Record<string, unknown>;
  noHang?: boolean;
  transportHeaderIssues?: 'any' | 'none';
  transportSessionId?: 'defined' | 'undefined' | 'any';
  expectations?: Record<string, ManifestExpectation>;
}

const manifest = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'manifest/scenarios.json'), 'utf8'),
) as { scenarios: Record<string, ManifestScenario> };

function byId(results: TestResult[]): Map<string, TestResult> {
  return new Map(results.map((r) => [r.id, r]));
}

function asHttp(t: unknown): { headerIssues?: unknown[]; sessionId?: string } {
  return t as { headerIssues?: unknown[]; sessionId?: string };
}

describe('e2e scenario manifest (client-robustness)', () => {
  for (const [name, sc] of Object.entries(manifest.scenarios)) {
    it(`scenario: ${name}`, async () => {
      const setup: ScenarioSetup = {
        era: sc.era,
        transport: sc.transport,
        protocolVersion: sc.protocolVersion,
        maxLineBytes: sc.maxLineBytes,
        options: { ...(sc.options ?? {}) } as ScenarioSetup['options'],
      };
      const { outcome, dispose } = await runScenario(sc.fixture, setup, []);
      try {
        const map = byId(outcome.results);

        if (sc.noHang) {
          expect(
            map.get('engine overall-timeout'),
            'must not hit the overall run timeout',
          ).toBeUndefined();
        }

        for (const [testId, exp] of Object.entries(sc.expectations ?? {})) {
          const actual = map.get(testId);
          expect(actual, `missing result for '${testId}'`).toBeDefined();
          expect(actual!.status, `status mismatch for '${testId}'`).toBe(exp.status);
          if (exp.layer !== undefined) {
            expect(actual!.error?.layer, `layer mismatch for '${testId}'`).toBe(exp.layer);
          }
        }

        if (sc.transportHeaderIssues !== undefined && outcome.transport !== undefined) {
          const issues = asHttp(outcome.transport).headerIssues ?? [];
          if (sc.transportHeaderIssues === 'any') expect(issues.length).toBeGreaterThan(0);
          else expect(issues.length).toBe(0);
        }
        if (sc.transportSessionId !== undefined && outcome.transport !== undefined) {
          const sid = asHttp(outcome.transport).sessionId;
          if (sc.transportSessionId === 'defined') expect(sid).toBeDefined();
          else if (sc.transportSessionId === 'undefined') expect(sid).toBeUndefined();
        }
      } finally {
        await dispose();
      }
    }, 30000);
  }
});
