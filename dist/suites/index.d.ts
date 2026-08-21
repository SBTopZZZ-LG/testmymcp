import type { TestLevel } from '../core/types/test-result.js';
import type { SuiteContext } from '../engine/ctx.js';
import { runConnectivitySuite } from './connectivity.js';
export interface TestSuite {
    name: string;
    level: TestLevel;
    run: (ctx: SuiteContext) => ReturnType<typeof runConnectivitySuite>;
}
export declare const SUITES: readonly TestSuite[];
export declare function selectSuites(maxLevel: TestLevel): readonly TestSuite[];
