import type { Transport } from '../../transports/transport.js';
import type { IdStyle } from '../jsonrpc/id.js';
import type { TraceStore } from '../tracing/store.js';
import type { ProtocolEra, ProtocolVersion } from '../types/protocol.js';
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
export declare class UnsupportedProtocolVersionError extends Error {
    readonly requested: string;
    constructor(requested: string);
}
export interface ProtocolAdapterFactory {
    create(eraOrVersion: ProtocolEra | ProtocolVersion, options: AdapterFactoryOptions): ProtocolAdapter;
}
export declare class DefaultProtocolAdapterFactory implements ProtocolAdapterFactory {
    create(eraOrVersion: ProtocolEra | ProtocolVersion, options: AdapterFactoryOptions): ProtocolAdapter;
}
export declare const protocolAdapterFactory: ProtocolAdapterFactory;
