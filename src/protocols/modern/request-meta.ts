import type { ServerInfo } from '../../core/protocol/adapter.js';
import type { ClientCapabilities } from '../../core/protocol/capabilities.js';
import { toClientCapabilitiesJson } from '../../core/protocol/capabilities.js';
import type { ProtocolVersion } from '../../core/types/protocol.js';

export interface ModernRequestMeta {
  protocolVersion: ProtocolVersion;
  clientInfo: ServerInfo;
  clientCapabilities: ClientCapabilities;
  logLevel?: string;
  progressToken?: string | number;
  extra?: Record<string, unknown>;
}

export const PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
export const CLIENT_INFO_KEY = 'io.modelcontextprotocol/clientInfo';
export const CLIENT_CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';
export const LOG_LEVEL_KEY = 'io.modelcontextprotocol/logLevel';

export function buildRequestMeta(options: ModernRequestMeta): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    [PROTOCOL_VERSION_KEY]: options.protocolVersion,
    [CLIENT_CAPABILITIES_KEY]: toClientCapabilitiesJson(options.clientCapabilities),
  };
  const clientInfo = options.clientInfo;
  if (clientInfo.name !== undefined || clientInfo.version !== undefined) {
    meta[CLIENT_INFO_KEY] = {
      name: clientInfo.name ?? 'testmymcp',
      version: clientInfo.version ?? '0.1.0',
    };
  }
  if (options.logLevel !== undefined) meta[LOG_LEVEL_KEY] = options.logLevel;
  if (options.progressToken !== undefined) meta.progressToken = options.progressToken;
  if (options.extra !== undefined) {
    for (const [key, value] of Object.entries(options.extra)) meta[key] = value;
  }
  return meta;
}

/**
 * Attach `_meta` to a params object, preserving any existing request params.
 * The `_meta` field is injected at the top level of `params` per the modern spec.
 */
export function withRequestMeta(
  params: object | undefined,
  meta: ModernRequestMeta,
): Record<string, unknown> | undefined {
  const metaObject = buildRequestMeta(meta);
  if (params === undefined) return { _meta: metaObject };
  return { ...(params as Record<string, unknown>), _meta: metaObject };
}
