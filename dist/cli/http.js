import { createReporter } from '../reporting/index.js';
import { computeSummary } from '../reporting/summary.js';
import { runTarget } from '../sessions/index.js';
export async function runHttp(options) {
    const auth = options.token !== undefined ? { mode: 'bearer', token: options.token } : { mode: 'none' };
    const target = {
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
//# sourceMappingURL=http.js.map