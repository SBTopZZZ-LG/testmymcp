import { TestLevel } from '../core/types/test-result.js';
import { fail, pass, warn } from '../engine/result.js';
const SETTLE_WINDOW_MS = 150;
const POLL_INTERVAL_MS = 25;
function settleUntilExitOrTimeout(ctx, timeoutMs) {
    return new Promise((resolve) => {
        const started = ctx.now();
        const timer = setInterval(() => {
            if (ctx.observed.exit !== null || ctx.now() - started >= timeoutMs) {
                clearInterval(timer);
                resolve();
            }
        }, POLL_INTERVAL_MS);
    });
}
export async function runConnectivitySuite(ctx) {
    const results = [];
    const started = ctx.now();
    const transport = 'stdio';
    await settleUntilExitOrTimeout(ctx, SETTLE_WINDOW_MS);
    if (ctx.observed.exit !== null || ctx.adapter.state === 'failed') {
        const exit = ctx.observed.exit;
        const detail = exit !== null
            ? `server exited prematurely (code ${exit.code}, signal ${exit.signal ?? 'none'})`
            : 'server failed to start';
        results.push(fail('connect spawn', 'connectivity', TestLevel.Connectivity, 'transport', 'spawn', detail, {
            transport,
            durationMs: ctx.now() - started,
        }));
    }
    else {
        results.push(pass('connect spawn', 'connectivity', TestLevel.Connectivity, {
            transport,
            durationMs: ctx.now() - started,
        }));
    }
    if (ctx.observed.garbageLines.length > 0) {
        results.push(fail('connect stdout-garbage', 'connectivity', TestLevel.Connectivity, 'transport', 'framing', `garbage output on stdout during startup (${ctx.observed.garbageLines.length} line(s))`, { transport, durationMs: 0, evidence: ctx.observed.garbageLines.slice(0, 5) }));
    }
    else {
        results.push(pass('connect stdout-clean', 'connectivity', TestLevel.Connectivity, {
            transport,
            durationMs: 0,
        }));
    }
    const stderrObserved = ctx.observed.stderrLines;
    results.push(stderrObserved.length > 0
        ? warn('connect stderr-output', 'connectivity', TestLevel.Connectivity, `server wrote ${stderrObserved.length} log line(s) to stderr`, { transport, durationMs: 0, evidence: stderrObserved.slice(0, 5) })
        : pass('connect stderr-capture', 'connectivity', TestLevel.Connectivity, {
            transport,
            durationMs: 0,
        }));
    return results;
}
//# sourceMappingURL=connectivity.js.map