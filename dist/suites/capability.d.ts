import { type TestResult } from '../core/types/test-result.js';
import type { SuiteContext } from '../engine/ctx.js';
export declare function runCapabilitySuite(ctx: SuiteContext): Promise<TestResult[]>;
