import type { ServerInfo } from '../../core/protocol/adapter.js';
import type { ClientCapabilities } from '../../core/protocol/capabilities.js';
import type { ProtocolVersion } from '../../core/types/protocol.js';
export interface ModernRequestMeta {
    protocolVersion: ProtocolVersion;
    clientInfo: ServerInfo;
    clientCapabilities: ClientCapabilities;
    logLevel?: string;
    progressToken?: string | number;
    extra?: Record<string, unknown>;
}
export declare const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
export declare const CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";
export declare const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
export declare const LOG_LEVEL_KEY = "io.modelcontextprotocol/logLevel";
export declare function buildRequestMeta(options: ModernRequestMeta): Record<string, unknown>;
/**
 * Attach `_meta` to a params object, preserving any existing request params.
 * The `_meta` field is injected at the top level of `params` per the modern spec.
 */
export declare function withRequestMeta(params: object | undefined, meta: ModernRequestMeta): Record<string, unknown> | undefined;
