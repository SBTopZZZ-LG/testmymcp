import { JsonRpcRemoteError } from '../core/jsonrpc/multiplexer.js';
import { TimeoutError } from '../core/timeouts/deadline.js';
import type {
  FailureLayer,
  Severity,
  TestCategory,
  TestLevel,
  TestResult,
  TestStatus,
} from '../core/types/test-result.js';

export function resolveErrorLayer(error: unknown, method: string | undefined): FailureLayer {
  if (error instanceof TimeoutError) return 'transport';
  if (error instanceof JsonRpcRemoteError) {
    // Modern spec error codes are protocol-level regardless of method.
    if (error.code === -32020 || error.code === -32021 || error.code === -32022) return 'protocol';
    if (method !== undefined && method.startsWith('tools/')) return 'application';
    return 'protocol';
  }
  return 'transport';
}

export interface ResultExtras {
  protocol?: TestResult['protocol'];
  protocolEra?: TestResult['protocolEra'];
  transport?: TestResult['transport'];
  evidence?: unknown;
  warnings?: string[];
  durationMs?: number;
  request?: TestResult['request'];
  response?: TestResult['response'];
  error?: TestResult['error'];
}

function base(
  id: string,
  category: TestCategory,
  level: TestLevel,
  status: TestStatus,
  severity: Severity,
  extras: ResultExtras = {},
): TestResult {
  return {
    id,
    category,
    level,
    status,
    severity,
    durationMs: extras.durationMs ?? 0,
    protocol: extras.protocol,
    protocolEra: extras.protocolEra,
    transport: extras.transport,
    evidence: extras.evidence,
    warnings: extras.warnings,
    request: extras.request,
    response: extras.response,
    error: extras.error,
  };
}

export function pass(
  id: string,
  category: TestCategory,
  level: TestLevel,
  extras: ResultExtras = {},
): TestResult {
  return base(id, category, level, 'pass', 'info', extras);
}

export function warn(
  id: string,
  category: TestCategory,
  level: TestLevel,
  message: string,
  extras: ResultExtras = {},
): TestResult {
  return base(id, category, level, 'warn', 'medium', {
    ...extras,
    warnings: [message, ...(extras.warnings ?? [])],
  });
}

export function skip(
  id: string,
  category: TestCategory,
  level: TestLevel,
  reason: string,
  extras: ResultExtras = {},
): TestResult {
  return base(id, category, level, 'skip', 'info', {
    ...extras,
    warnings: [reason, ...(extras.warnings ?? [])],
  });
}

export function fail(
  id: string,
  category: TestCategory,
  level: TestLevel,
  layer: FailureLayer,
  type: string,
  message: string,
  extras: ResultExtras = {},
): TestResult {
  return base(id, category, level, 'fail', 'high', {
    ...extras,
    error: { layer, type, message },
  });
}

export function fromError(
  id: string,
  category: TestCategory,
  level: TestLevel,
  error: unknown,
  layer: FailureLayer = 'protocol',
  extras: ResultExtras = {},
): TestResult {
  const message = error instanceof Error ? error.message : String(error);
  return fail(
    id,
    category,
    level,
    layer,
    error instanceof Error ? error.name : 'Error',
    message,
    extras,
  );
}
