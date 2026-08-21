import type { ReportFormat, ReportOptions, Reporter } from './types.js';
export declare function createReporter(format: ReportFormat, options?: ReportOptions): Reporter;
export * from './types.js';
export * from './summary.js';
export * from './terminal.js';
export * from './json.js';
