import {
  parseServerCapabilities,
  toClientCapabilitiesJson,
  type ClientCapabilities,
  type ServerCapabilities,
} from '../../core/protocol/capabilities.js';
import type { ServerInfo } from '../../core/protocol/adapter.js';
import { isProtocolVersion, type ProtocolVersion } from '../../core/types/protocol.js';

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

export function buildInitializeParams(options: BuildInitializeParamsOptions): Record<string, unknown> {
  return {
    protocolVersion: options.protocolVersion,
    capabilities: toClientCapabilitiesJson(options.clientCapabilities),
    clientInfo: {
      name: options.clientInfo.name ?? 'testmymcp',
      version: options.clientInfo.version ?? '0.1.0',
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseInitializeResult(result: unknown): InitializeResult {
  if (!isRecord(result)) throw new Error('initialize result is not an object');
  if (typeof result.protocolVersion !== 'string') {
    throw new Error('initialize result is missing protocolVersion');
  }
  if (!isProtocolVersion(result.protocolVersion)) {
    throw new Error(`initialize returned unknown protocol version "${result.protocolVersion}"`);
  }
  const serverInfoRaw = isRecord(result.serverInfo) ? result.serverInfo : undefined;
  const serverInfo: ServerInfo = {
    name: typeof serverInfoRaw?.name === 'string' ? serverInfoRaw.name : undefined,
    version: typeof serverInfoRaw?.version === 'string' ? serverInfoRaw.version : undefined,
  };
  return {
    protocolVersion: result.protocolVersion,
    serverInfo,
    serverCapabilities: parseServerCapabilities(result.capabilities, result.protocolVersion),
    raw: result,
  };
}