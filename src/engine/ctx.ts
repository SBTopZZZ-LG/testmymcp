import type {
  PromptDefinition,
  ResourceDefinition,
  ResourceTemplateDefinition,
  ToolDefinition,
} from '../core/primitives/types.js';
import type { ProtocolAdapter } from '../core/protocol/adapter.js';
import type { NegotiatedSession } from '../core/protocol/adapter.js';
import type { TraceStore } from '../core/tracing/store.js';
import type { ProtocolEra, TransportType } from '../core/types/protocol.js';
import type { ExitInfo, OversizeInfo } from '../transports/transport.js';
import type { RunOptions } from './options.js';

export interface ObservedTransportEvents {
  readonly garbageLines: string[];
  readonly stderrLines: string[];
  readonly oversize: OversizeInfo[];
  exit: ExitInfo | null;
}

export interface SharedDiscovery {
  session: NegotiatedSession | undefined;
  tools: ToolDefinition[];
  resources: ResourceDefinition[];
  resourceTemplates: ResourceTemplateDefinition[];
  prompts: PromptDefinition[];
}

export function createObservedEvents(): ObservedTransportEvents {
  return { garbageLines: [], stderrLines: [], oversize: [], exit: null };
}

export function createSharedDiscovery(): SharedDiscovery {
  return { session: undefined, tools: [], resources: [], resourceTemplates: [], prompts: [] };
}

export interface SuiteContext {
  adapter: ProtocolAdapter;
  observed: ObservedTransportEvents;
  options: RunOptions;
  trace: TraceStore | undefined;
  shared: SharedDiscovery;
  now: () => number;
  transport: TransportType;
  era: ProtocolEra;
}
