import { TestLevel } from '../core/types/test-result.js';
import type { ProtocolEra, ProtocolVersion } from '../core/types/protocol.js';
import { protocolAdapterFactory } from '../core/protocol/factory.js';
import { TraceStore } from '../core/tracing/store.js';
import { StreamableHttpTransport, LegacySseTransport } from '../transports/http/index.js';
import type { AuthConfig, StreamableHttpAccept } from '../transports/http/index.js';
import { defaultRunOptions, type RunOptions } from '../engine/options.js';
import { TestEngine } from '../engine/engine.js';
import { computeSummary } from '../reporting/summary.js';
import { createReporter, type ReportMeta } from '../reporting/index.js';
import type { ToolExecutionMode } from '../core/tools/safety.js';

export type HttpTransportKind = 'streamable-http' | 'legacy-sse';

export interface HttpCommandOptions {
  url: string;
  transport: HttpTransportKind;
  mode: ToolExecutionMode;
  level: number;
  json: boolean;
  timeoutMs: number;
  showSecrets: boolean;
  token?: string;
  accept?: StreamableHttpAccept;
  era?: ProtocolEra;
  version?: ProtocolVersion;
  extensions?: Record<string, unknown>;
}

const SHUTDOWN_TIMEOUT_MS = 5000;

export async function runHttp(options: HttpCommandOptions): Promise<number> {
  const runOptions: RunOptions = defaultRunOptions({
    mode: options.mode,
    maxLevel: options.level as TestLevel,
    defaultTimeoutMs: options.timeoutMs,
  });

  const auth: AuthConfig = options.token !== undefined ? { mode: 'bearer', token: options.token } : { mode: 'none' };
  const era: ProtocolEra = options.era ?? 'legacy';
  const version: ProtocolVersion = options.version ?? (era === 'modern' ? '2026-07-28' : '2025-11-25');

  const transport =
    options.transport === 'legacy-sse'
      ? new LegacySseTransport({ url: options.url, auth, requestTimeoutMs: options.timeoutMs })
      : new StreamableHttpTransport({
          url: options.url,
          auth,
          accept: options.accept ?? 'json',
          protocolVersion: version,
          era,
          requestTimeoutMs: options.timeoutMs,
        });

  const trace = new TraceStore({ showSecrets: options.showSecrets });

  const adapter = protocolAdapterFactory.create(era, {
    transport,
    trace,
    requestTimeoutMs: options.timeoutMs,
    initTimeoutMs: Math.min(options.timeoutMs, 15_000),
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    preferVersion: version,
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
    protocol: session?.protocolVersion ?? version,
    protocolEra: session !== undefined ? session.protocolVersion === '2026-07-28' ? 'modern' : 'legacy' : era,
    transport: options.transport,
    startedAt,
    durationMs: Date.now() - startedAt,
    command: options.url,
    serverName: session?.serverInfo.name,
    serverVersion: session?.serverInfo.version,
  };

  const reporter = createReporter(options.json ? 'json' : 'terminal');
  process.stdout.write(reporter.render(results, meta));

  return summary.fail > 0 ? 1 : 0;
}
