import type { ToolExecutionMode } from '../core/tools/safety.js';
import type { ProtocolEra, ProtocolVersion } from '../core/types/protocol.js';
import { type HttpTransportKind } from '../sessions/index.js';
import type { StreamableHttpAccept } from '../transports/http/index.js';
export type { HttpTransportKind };
export interface HttpCommandOptions {
    url: string;
    transport: HttpTransportKind;
    mode: ToolExecutionMode;
    level: number;
    json: boolean;
    timeoutMs: number;
    showSecrets: boolean;
    token?: string;
    accept?: StreamableHttpAccept;
    era?: ProtocolEra;
    version?: ProtocolVersion;
    extensions?: Record<string, unknown>;
}
export declare function runHttp(options: HttpCommandOptions): Promise<number>;
