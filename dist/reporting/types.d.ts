import type { ProtocolEra, ProtocolVersion, TransportType } from '../core/types/protocol.js';
import type { TestResult } from '../core/types/test-result.js';
export type ReportFormat = 'terminal' | 'json';
export interface ReportMeta {
    protocol?: ProtocolVersion;
    protocolEra?: ProtocolEra;
    transport?: TransportType;
    serverName?: string;
    serverVersion?: string;
    startedAt?: number;
    durationMs?: number;
    command?: string;
}
export interface Reporter {
    readonly format: ReportFormat;
    render(results: readonly TestResult[], meta?: ReportMeta): string;
}
