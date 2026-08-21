import { parseServerCapabilities, type ServerCapabilities } from '../../core/protocol/capabilities.js';
import type { ServerInfo } from '../../core/protocol/adapter.js';
import { isProtocolVersion, type ProtocolVersion } from '../../core/types/protocol.js';

export interface DiscoverResult {
  supportedVersions: string[];
  capabilities: ServerCapabilities;
  serverInfo: ServerInfo;
  instructions?: string;
  ttlMs?: number;
  cacheScope?: 'public' | 'private';
  raw: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseDiscoverResult(result: unknown): DiscoverResult {
  if (!isRecord(result)) throw new Error('server/discover result is not an object');

  const supportedVersions: string[] = Array.isArray(result.supportedVersions)
    ? result.supportedVersions.filter((v): v is string => typeof v === 'string')
    : [];

  const rawCapabilities = isRecord(result.capabilities) ? result.capabilities : {};
  const serverInfoRaw = isRecord(result._meta)
    ? isRecord(result._meta['io.modelcontextprotocol/serverInfo'])
      ? result._meta['io.modelcontextprotocol/serverInfo']
      : undefined
    : undefined;

  const serverInfo: ServerInfo = {
    name: typeof serverInfoRaw?.name === 'string' ? serverInfoRaw.name : undefined,
    version: typeof serverInfoRaw?.version === 'string' ? serverInfoRaw.version : undefined,
  };

  return {
    supportedVersions,
    capabilities: parseServerCapabilities(rawCapabilities, '2026-07-28'),
    serverInfo,
    instructions: typeof result.instructions === 'string' ? result.instructions : undefined,
    ttlMs: typeof result.ttlMs === 'number' ? result.ttlMs : undefined,
    cacheScope: result.cacheScope === 'public' || result.cacheScope === 'private' ? result.cacheScope : undefined,
    raw: result,
  };
}

export function selectSupportedVersion(
  supported: readonly string[],
  preferred: ProtocolVersion,
): ProtocolVersion | undefined {
  const known = supported.filter((v): v is ProtocolVersion => isProtocolVersion(v));
  if (known.includes(preferred)) return preferred;
  if (known.includes('2026-07-28')) return '2026-07-28';
  return known[0];
}
