import type { NegotiatedSession, ProtocolAdapter } from '../core/protocol/adapter.js';
import type { ToolExecutionMode } from '../core/tools/safety.js';
import { TraceStore } from '../core/tracing/store.js';
import type { ProtocolEra } from '../core/types/protocol.js';
import { type TestResult } from '../core/types/test-result.js';
import type { ReportMeta } from '../reporting/index.js';
import type { Transport } from '../transports/transport.js';
import type { SessionTarget } from './types.js';
export interface BuildSessionOptions {
    timeoutMs: number;
    showSecrets?: boolean;
    shutdownTimeoutMs?: number;
    extensions?: Record<string, unknown>;
}
export interface BuiltSession {
    transport: Transport;
    adapter: ProtocolAdapter;
    trace: TraceStore;
    era: ProtocolEra;
}
export interface RunTargetPreferences {
    mode: ToolExecutionMode;
    level: number;
    timeoutMs: number;
    showSecrets?: boolean;
    maxSchemaBytes?: number;
    extensions?: Record<string, unknown>;
}
export interface TargetRunOutcome {
    results: TestResult[];
    meta: ReportMeta;
}
export declare function buildSession(target: SessionTarget, options: BuildSessionOptions): BuiltSession;
export declare function runTarget(target: SessionTarget, preferences: RunTargetPreferences): Promise<TargetRunOutcome>;
export declare function probeTarget(target: SessionTarget, options: BuildSessionOptions): Promise<NegotiatedSession>;
