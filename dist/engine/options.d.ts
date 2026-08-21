import type { ToolExecutionMode } from '../core/tools/safety.js';
import { TestLevel } from '../core/types/test-result.js';
export interface RunOptions {
    mode: ToolExecutionMode;
    maxLevel: TestLevel;
    defaultTimeoutMs: number;
    connectTimeoutMs?: number;
    requestTimeoutMs?: number;
    toolTimeoutMs?: number;
    maxSchemaBytes?: number;
    maxPaginationPages?: number;
    maxCallsPerTool?: number;
}
export declare function defaultRunOptions(overrides?: Partial<RunOptions>): RunOptions;
