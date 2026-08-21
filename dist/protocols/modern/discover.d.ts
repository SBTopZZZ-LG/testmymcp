import type { ServerInfo } from '../../core/protocol/adapter.js';
import { type ServerCapabilities } from '../../core/protocol/capabilities.js';
import { type ProtocolVersion } from '../../core/types/protocol.js';
export interface DiscoverResult {
    supportedVersions: string[];
    capabilities: ServerCapabilities;
    serverInfo: ServerInfo;
    instructions?: string;
    ttlMs?: number;
    cacheScope?: 'public' | 'private';
    raw: Record<string, unknown>;
}
export declare function parseDiscoverResult(result: unknown): DiscoverResult;
export declare function selectSupportedVersion(supported: readonly string[], preferred: ProtocolVersion): ProtocolVersion | undefined;
