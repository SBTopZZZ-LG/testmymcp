import { type TestResult } from '../core/types/test-result.js';
import type { SuiteContext } from '../engine/ctx.js';
export declare function runProtocolSuite(ctx: SuiteContext): Promise<TestResult[]>;
