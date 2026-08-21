import type { ToolExecutionMode } from '../core/tools/safety.js';
import type { ProtocolEra, ProtocolVersion } from '../core/types/protocol.js';
import { createReporter } from '../reporting/index.js';
import { computeSummary } from '../reporting/summary.js';
import { type HttpTransportKind, type SessionTarget, runTarget } from '../sessions/index.js';
import type { StreamableHttpAccept } from '../transports/http/index.js';
import type { AuthConfig } from '../transports/http/types.js';

export type { HttpTransportKind };

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

export async function runHttp(options: HttpCommandOptions): Promise<number> {
  const auth: AuthConfig =
    options.token !== undefined ? { mode: 'bearer', token: options.token } : { mode: 'none' };

  const target: SessionTarget = {
    transport: 'http',
    url: options.url,
    httpTransport: options.transport,
    auth,
    era: options.era,
    version: options.version,
    accept: options.accept,
  };

  const { results, meta } = await runTarget(target, {
    mode: options.mode,
    level: options.level,
    timeoutMs: options.timeoutMs,
    showSecrets: options.showSecrets,
    extensions: options.extensions,
  });

  const summary = computeSummary(results);
  const reporter = createReporter(options.json ? 'json' : 'terminal');
  process.stdout.write(reporter.render(results, meta));

  return summary.fail > 0 ? 1 : 0;
}
