import type { JsonRpcId } from '../jsonrpc/messages.js';
import type { RequestMultiplexer } from '../jsonrpc/multiplexer.js';
import type { ProtocolEra, ProtocolVersion } from '../types/protocol.js';
import type { ServerCapabilities } from './capabilities.js';

export type LifecycleState =
  | 'created'
  | 'connecting'
  | 'connected'
  | 'initializing'
  | 'operational'
  | 'shutting-down'
  | 'closed'
  | 'failed';

export interface ServerInfo {
  name?: string;
  version?: string;
}

export interface NegotiatedSession {
  protocolVersion: ProtocolVersion;
  negotiated: boolean;
  claimedVersion?: ProtocolVersion;
  serverInfo: ServerInfo;
  clientInfo: ServerInfo;
  serverCapabilities: ServerCapabilities;
}

export interface InitializeOptions {
  skipInitialized?: boolean;
}

export interface ProtocolAdapter {
  readonly era: ProtocolEra;
  readonly state: LifecycleState;
  readonly mux: RequestMultiplexer;
  connect(): Promise<void>;
  initialize(options?: InitializeOptions): Promise<NegotiatedSession>;
  request<T = unknown>(method: string, params?: object, timeoutMs?: number): Promise<T>;
  rawRequest<T = unknown>(
    id: JsonRpcId,
    method: string,
    params?: object,
    timeoutMs?: number,
  ): Promise<T>;
  notify(method: string, params?: object): Promise<void>;
  shutdown(): Promise<void>;
  disconnect(): Promise<void>;
}
