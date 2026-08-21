import { createReporter } from '../reporting/index.js';
import { computeSummary } from '../reporting/summary.js';
import { runTarget } from '../sessions/index.js';
const DEFAULT_MAX_SCHEMA_BYTES = 1024 * 1024;
export async function runStdio(options) {
    const target = {
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
    const reporter = createReporter(options.json ? 'json' : 'terminal', options.jsonSummary === true ? { stripEvidence: true } : undefined);
    process.stdout.write(reporter.render(results, meta));
    return summary.fail > 0 ? 1 : 0;
}
//# sourceMappingURL=stdio.js.map