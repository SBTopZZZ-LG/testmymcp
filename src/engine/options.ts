import { TestLevel } from '../core/types/test-result.js';
import type { ToolExecutionMode } from '../core/tools/safety.js';

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

export function defaultRunOptions(overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    mode: 'safe',
    maxLevel: TestLevel.Capability,
    defaultTimeoutMs: 30_000,
    ...overrides,
  };
}