import type { TestResult } from '../core/types/test-result.js';
import type { ReportMeta, Reporter } from './types.js';
export declare function renderTerminal(results: readonly TestResult[], meta?: ReportMeta): string;
export declare const terminalReporter: Reporter;
