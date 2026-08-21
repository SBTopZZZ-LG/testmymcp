import type { TestLevel } from '../core/types/test-result.js';
import type { SuiteContext } from '../engine/ctx.js';
import { runBehavioralSuite } from './behavioral.js';
import { runCapabilitySuite } from './capability.js';
import { runConnectivitySuite } from './connectivity.js';
import { runDiscoverySuite } from './discovery.js';
import { runModernProtocolSuite } from './protocol-modern.js';
import { runProtocolSuite } from './protocol.js';
import { runRobustnessSuite } from './robustness.js';

export interface TestSuite {
  name: string;
  level: TestLevel;
  run: (ctx: SuiteContext) => ReturnType<typeof runConnectivitySuite>;
}

export const SUITES: readonly TestSuite[] = [
  { name: 'connectivity', level: 0 as TestLevel, run: runConnectivitySuite },
  {
    name: 'protocol',
    level: 1 as TestLevel,
    run: (ctx) => (ctx.era === 'modern' ? runModernProtocolSuite(ctx) : runProtocolSuite(ctx)),
  },
  { name: 'discovery', level: 2 as TestLevel, run: runDiscoverySuite },
  { name: 'capability', level: 3 as TestLevel, run: runCapabilitySuite },
  { name: 'behavioral', level: 4 as TestLevel, run: runBehavioralSuite },
  { name: 'robustness', level: 5 as TestLevel, run: runRobustnessSuite },
];

export function selectSuites(maxLevel: TestLevel): readonly TestSuite[] {
  return SUITES.filter((suite) => suite.level <= maxLevel).sort((a, b) => a.level - b.level);
}
