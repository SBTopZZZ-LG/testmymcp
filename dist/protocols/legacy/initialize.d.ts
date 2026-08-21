import type { ServerInfo } from '../../core/protocol/adapter.js';
import { type ClientCapabilities, type ServerCapabilities } from '../../core/protocol/capabilities.js';
import { type ProtocolVersion } from '../../core/types/protocol.js';
export interface InitializeResult {
    protocolVersion: ProtocolVersion;
    serverInfo: ServerInfo;
    serverCapabilities: ServerCapabilities;
    raw: Record<string, unknown>;
}
export interface BuildInitializeParamsOptions {
    protocolVersion: ProtocolVersion;
    clientInfo: ServerInfo;
    clientCapabilities: ClientCapabilities;
}
export declare function buildInitializeParams(options: BuildInitializeParamsOptions): Record<string, unknown>;
export declare function parseInitializeResult(result: unknown): InitializeResult;
