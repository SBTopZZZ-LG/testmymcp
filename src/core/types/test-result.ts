import type { ProtocolEra, ProtocolVersion, TransportType } from './protocol.js';
import type { TraceMessage } from './trace.js';

export type FailureLayer = 'transport' | 'jsonrpc' | 'protocol' | 'application';

export type TestStatus = 'pass' | 'fail' | 'warn' | 'skip';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type TestCategory =
  | 'connectivity'
  | 'protocol'
  | 'discovery'
  | 'capability'
  | 'behavioral'
  | 'robustness'
  | 'security'
  | 'fuzz';

export enum TestLevel {
  Connectivity = 0,
  Protocol = 1,
  Discovery = 2,
  Capability = 3,
  Behavioral = 4,
  Robustness = 5,
  Security = 6,
  Fuzz = 7,
}

export interface TestError {
  layer: FailureLayer;
  type: string;
  code?: number;
  message: string;
}

export interface TestResult {
  id: string;
  category: TestCategory;
  level: TestLevel;
  status: TestStatus;
  severity: Severity;
  protocol?: ProtocolVersion;
  protocolEra?: ProtocolEra;
  transport?: TransportType;
  durationMs: number;
  request?: TraceMessage;
  response?: TraceMessage;
  error?: TestError;
  evidence?: unknown;
  warnings?: string[];
}
