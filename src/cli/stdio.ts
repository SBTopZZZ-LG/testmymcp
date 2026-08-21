import { TestLevel } from '../core/types/test-result.js';
import type { ProtocolEra, ProtocolVersion } from '../core/types/protocol.js';
import { protocolAdapterFactory } from '../core/protocol/factory.js';
import { TraceStore } from '../core/tracing/store.js';
import { StdioTransport } from '../transports/stdio/index.js';
import { defaultRunOptions, type RunOptions } from '../engine/options.js';
import { TestEngine } from '../engine/engine.js';
import { computeSummary } from '../reporting/summary.js';
import { createReporter, type ReportMeta } from '../reporting/index.js';
import type { ToolExecutionMode } from '../core/tools/safety.js';

export interface StdioCommandOptions {
  command: string;
  mode: ToolExecutionMode;
  level: number;
  json: boolean;
  timeoutMs: number;
  showSecrets: boolean;
  maxSchemaBytes?: number;
  maxLineBytes?: number;
  preferVersion?: ProtocolVersion;
  era?: ProtocolEra;
  extensions?: Record<string, unknown>;
}

const DEFAULT_MAX_SCHEMA_BYTES = 1024 * 1024;
const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;
const SHUTDOWN_TIMEOUT_MS = 5000;

export async function runStdio(options: StdioCommandOptions): Promise<number> {
  const runOptions: RunOptions = defaultRunOptions({
    mode: options.mode,
    maxLevel: options.level as TestLevel,
    defaultTimeoutMs: options.timeoutMs,
    maxSchemaBytes: options.maxSchemaBytes ?? DEFAULT_MAX_SCHEMA_BYTES,
  });

  const transport = new StdioTransport({
    command: options.command,
    maxLineBytes: options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES,
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
  });
  const trace = new TraceStore({ showSecrets: options.showSecrets });

  const era = options.era ?? 'legacy';
  const adapter = protocolAdapterFactory.create(era, {
    transport,
    trace,
    requestTimeoutMs: options.timeoutMs,
    initTimeoutMs: Math.min(options.timeoutMs, 15_000),
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    preferVersion: options.preferVersion,
    extensions: options.extensions,
  });

  const engine = new TestEngine({ adapter, transport, trace, options: runOptions });
  const startedAt = Date.now();

  let results;
  try {
    results = await engine.run();
  } finally {
    try {
      await engine.dispose();
    } catch {
      // best-effort teardown
    }
  }

  const summary = computeSummary(results);
  const session = engine.shared.session;
  const meta: ReportMeta = {
    protocol: session?.protocolVersion ?? options.preferVersion,
    protocolEra: session !== undefined ? session.protocolVersion === '2026-07-28' ? 'modern' : 'legacy' : era,
    transport: 'stdio',
    startedAt,
    durationMs: Date.now() - startedAt,
    command: options.command,
    serverName: session?.serverInfo.name,
    serverVersion: session?.serverInfo.version,
  };

  const reporter = createReporter(options.json ? 'json' : 'terminal');
  process.stdout.write(reporter.render(results, meta));

  return summary.fail > 0 ? 1 : 0;
}