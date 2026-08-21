import type { ProtocolAdapter } from '../core/protocol/adapter.js';
import type { TraceStore } from '../core/tracing/store.js';
import { type TestResult } from '../core/types/test-result.js';
import type { Transport } from '../transports/transport.js';
import type { ObservedTransportEvents, SharedDiscovery } from './ctx.js';
import type { RunOptions } from './options.js';
export interface EngineSetup {
    adapter: ProtocolAdapter;
    transport: Transport;
    trace?: TraceStore;
    options: RunOptions;
}
export declare class TestEngine {
    private readonly setup;
    readonly observed: ObservedTransportEvents;
    readonly shared: SharedDiscovery;
    private readonly clock;
    constructor(setup: EngineSetup);
    run(): Promise<TestResult[]>;
    dispose(): Promise<void>;
    private runInternal;
    private buildObserver;
    private ctx;
}
