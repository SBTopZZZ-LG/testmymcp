import type { ToolDefinition } from '../primitives/types.js';
export type ToolRisk = 'safe' | 'readonly' | 'destructive';
export declare function classifyTool(tool: ToolDefinition): ToolRisk;
export type ToolExecutionMode = 'safe' | 'readonly' | 'all';
export declare function executionDecision(risk: ToolRisk, mode: ToolExecutionMode): {
    run: boolean;
    reason?: string;
};
