import type { ProtocolEra, ProtocolVersion } from '../core/types/protocol.js';
import { computeSummary } from '../reporting/summary.js';
import { createReporter } from '../reporting/index.js';
import { runTarget, type SessionTarget } from '../sessions/index.js';
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
  env?: Record<string, string>;
  extensions?: Record<string, unknown>;
}

const DEFAULT_MAX_SCHEMA_BYTES = 1024 * 1024;

export async function runStdio(options: StdioCommandOptions): Promise<number> {
  const target: SessionTarget = {
    transport: 'stdio',
    command: options.command,
    era: options.era,
    version: options.preferVersion,
    maxLineBytes: options.maxLineBytes,
    env: options.env,
  };

  const { results, meta } = await runTarget(target, {
    mode: options.mode,
    level: options.level,
    timeoutMs: options.timeoutMs,
    showSecrets: options.showSecrets,
    maxSchemaBytes: options.maxSchemaBytes ?? DEFAULT_MAX_SCHEMA_BYTES,
    extensions: options.extensions,
  });

  const summary = computeSummary(results);
  const reporter = createReporter(options.json ? 'json' : 'terminal');
  process.stdout.write(reporter.render(results, meta));

  return summary.fail > 0 ? 1 : 0;
}
