import type { TransportType } from './protocol.js';
import type { JsonRpcId } from '../jsonrpc/messages.js';

export type TraceDirection = 'in' | 'out';

export type TraceKind = 'request' | 'response' | 'notification' | 'log' | 'stderr' | 'event';

export interface TraceMessage {
  id: string;
  timestamp: number;
  direction: TraceDirection;
  kind: TraceKind;
  transport?: TransportType;
  method?: string;
  requestId?: JsonRpcId;
  headers?: Record<string, string>;
  payload?: unknown;
  latencyMs?: number;
  status?: string;
  error?: string;
  raw?: string;
}

export interface TraceStoreJson {
  kind: 'mcp-trace';
  version: 1;
  count: number;
  messages: TraceMessage[];
}