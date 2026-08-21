import { createLegacyProtocolAdapter } from '../../protocols/legacy/adapter.js';
import { createModernProtocolAdapter } from '../../protocols/modern/adapter.js';
import type { Transport } from '../../transports/transport.js';
import type { TraceStore } from '../tracing/store.js';
import type { IdStyle } from '../jsonrpc/id.js';
import type { ProtocolEra, ProtocolVersion } from '../types/protocol.js';
import { eraOfVersion } from '../types/protocol.js';
import type { ProtocolAdapter, ServerInfo } from './adapter.js';
import type { ClientCapabilities } from './capabilities.js';

export interface AdapterFactoryOptions {
  transport: Transport;
  clientInfo?: ServerInfo;
  clientCapabilities?: Partial<ClientCapabilities>;
  preferVersion?: ProtocolVersion;
  requestTimeoutMs?: number;
  initTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  idStyle?: IdStyle;
  clock?: () => number;
  trace?: TraceStore;
  /** Modern-only: extensions to declare in client capabilities (e.g. `io.modelcontextprotocol/tasks`). */
  extensions?: Record<string, unknown>;
  /** Modern-only: automatically retry on `input_required` MRTR results. */
  autoMrtr?: boolean;
}

export class UnsupportedProtocolVersionError extends Error {
  readonly requested: string;

  constructor(requested: string) {
    super(`no adapter for protocol version/era "${requested}"`);
    this.name = 'UnsupportedProtocolVersionError';
    this.requested = requested;
  }
}

export interface ProtocolAdapterFactory {
  create(eraOrVersion: ProtocolEra | ProtocolVersion, options: AdapterFactoryOptions): ProtocolAdapter;
}

export class DefaultProtocolAdapterFactory implements ProtocolAdapterFactory {
  create(eraOrVersion: ProtocolEra | ProtocolVersion, options: AdapterFactoryOptions): ProtocolAdapter {
    const directEra = eraOfVersion(eraOrVersion);
    const era: ProtocolEra =
      eraOrVersion === 'legacy' || eraOrVersion === 'modern'
        ? eraOrVersion
        : directEra ?? 'legacy';
    if (era === 'modern') {
      return createModernProtocolAdapter({
        transport: options.transport,
        clientInfo: options.clientInfo,
        clientCapabilities: options.clientCapabilities,
        preferVersion: options.preferVersion,
        requestTimeoutMs: options.requestTimeoutMs,
        discoverTimeoutMs: options.initTimeoutMs,
        shutdownTimeoutMs: options.shutdownTimeoutMs,
        idStyle: options.idStyle,
        clock: options.clock,
        trace: options.trace,
        extensions: options.extensions,
        autoMrtr: options.autoMrtr,
      });
    }
    return createLegacyProtocolAdapter({
      transport: options.transport,
      clientInfo: options.clientInfo,
      clientCapabilities: options.clientCapabilities,
      preferVersion: options.preferVersion,
      requestTimeoutMs: options.requestTimeoutMs,
      initTimeoutMs: options.initTimeoutMs,
      shutdownTimeoutMs: options.shutdownTimeoutMs,
      idStyle: options.idStyle,
      clock: options.clock,
      trace: options.trace,
    });
  }
}

export const protocolAdapterFactory: ProtocolAdapterFactory = new DefaultProtocolAdapterFactory();