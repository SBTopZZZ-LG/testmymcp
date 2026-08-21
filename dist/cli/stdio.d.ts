import type { ToolExecutionMode } from '../core/tools/safety.js';
import type { ProtocolEra, ProtocolVersion } from '../core/types/protocol.js';
export interface StdioCommandOptions {
    command: string;
    mode: ToolExecutionMode;
    level: number;
    json: boolean;
    jsonSummary?: boolean;
    timeoutMs: number;
    showSecrets: boolean;
    maxSchemaBytes?: number;
    maxLineBytes?: number;
    preferVersion?: ProtocolVersion;
    era?: ProtocolEra;
    env?: Record<string, string>;
    extensions?: Record<string, unknown>;
}
export declare function runStdio(options: StdioCommandOptions): Promise<number>;
