import { JsonRpcRemoteError } from '../core/jsonrpc/multiplexer.js';
import { TestLevel } from '../core/types/test-result.js';
import { fail, pass, resolveErrorLayer, skip } from '../engine/result.js';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasTool(tools, name) {
    return tools.some((t) => t.name === name);
}
function resultText(result) {
    const r = result;
    if (r === undefined)
        return '';
    const content = r['content'];
    if (Array.isArray(content)) {
        return content
            .map((c) => (isRecord(c) && typeof c['text'] === 'string' ? c['text'] : ''))
            .join('');
    }
    return '';
}
export async function runRobustnessSuite(ctx) {
    const results = [];
    const transport = ctx.transport;
    const tools = ctx.shared.tools;
    const reqTimeout = ctx.options.requestTimeoutMs ?? ctx.options.defaultTimeoutMs;
    if (!hasTool(tools, 'sum')) {
        results.push(skip('robustness sum-based', 'robustness', TestLevel.Robustness, 'no sum tool discovered', {
            transport,
            durationMs: 0,
        }));
        return results;
    }
    // --- Cancellation notification must not kill the server. -----------------
    {
        const started = ctx.now();
        try {
            await ctx.adapter.notify('notifications/cancelled', {
                requestId: 987654,
                reason: 'test cancel',
            });
            const list = (await ctx.adapter.request('tools/list', undefined, reqTimeout));
            const durationMs = ctx.now() - started;
            const ok = isRecord(list) && Array.isArray(list.tools);
            results.push(ok
                ? pass('robustness cancellation', 'robustness', TestLevel.Robustness, {
                    transport,
                    durationMs,
                })
                : fail('robustness cancellation', 'robustness', TestLevel.Robustness, 'application', 'server-unresponsive', 'server stopped responding after a cancellation notification', { transport, durationMs }));
        }
        catch (error) {
            results.push(fromRobustnessError('robustness cancellation', error, ctx, started));
        }
    }
    // --- Malformed tool input must be an application error, not a crash. ------
    {
        const started = ctx.now();
        let rejected = false;
        try {
            await ctx.adapter.request('tools/call', { name: 'sum', arguments: { a: 'not-a-number', b: 2 } }, reqTimeout);
        }
        catch (error) {
            rejected = error instanceof JsonRpcRemoteError && error.code === -32602;
        }
        const durationMs = ctx.now() - started;
        results.push(rejected
            ? pass('robustness malformed-input', 'robustness', TestLevel.Robustness, {
                transport,
                durationMs,
            })
            : fail('robustness malformed-input', 'robustness', TestLevel.Robustness, 'application', 'input-not-rejected', 'server accepted a type-violating tool input instead of rejecting it', { transport, durationMs }));
    }
    // --- Recovery: a valid call after a failure must still succeed. ----------
    {
        const started = ctx.now();
        let recovered = false;
        try {
            await ctx.adapter.request('tools/call', { name: 'sum', arguments: { a: 'bad', b: 1 } }, reqTimeout);
        }
        catch {
            /* expected */
        }
        try {
            const result = (await ctx.adapter.request('tools/call', { name: 'sum', arguments: { a: 3, b: 4 } }, reqTimeout));
            recovered = resultText(result) === '7';
        }
        catch {
            recovered = false;
        }
        const durationMs = ctx.now() - started;
        results.push(recovered
            ? pass('robustness error-recovery', 'robustness', TestLevel.Robustness, {
                transport,
                durationMs,
            })
            : fail('robustness error-recovery', 'robustness', TestLevel.Robustness, 'transport', 'no-recovery', 'server did not recover after a failed call', { transport, durationMs }));
    }
    // --- Concurrency stress: many parallel calls, all correct, mux clean. ----
    {
        const N = 16;
        const started = ctx.now();
        try {
            const sums = await Promise.all(Array.from({ length: N }, (_, i) => ctx.adapter.request('tools/call', { name: 'sum', arguments: { a: i, b: i + 1 } }, reqTimeout)));
            const bad = sums.filter((r, i) => resultText(r) !== String(i + (i + 1))).length;
            const durationMs = ctx.now() - started;
            if (bad === 0 && ctx.adapter.mux.pendingCount === 0) {
                results.push(pass('robustness concurrency-stress', 'robustness', TestLevel.Robustness, {
                    transport,
                    durationMs,
                    evidence: { calls: N },
                }));
            }
            else {
                results.push(fail('robustness concurrency-stress', 'robustness', TestLevel.Robustness, bad === 0 ? 'transport' : 'application', 'concurrency-mismatch', `${bad}/${N} concurrent stress calls mismatched; pending=${ctx.adapter.mux.pendingCount}`, {
                    transport,
                    durationMs,
                    evidence: { bad, pending: ctx.adapter.mux.pendingCount },
                }));
            }
        }
        catch (error) {
            results.push(fromRobustnessError('robustness concurrency-stress', error, ctx, started));
        }
    }
    return results;
}
function fromRobustnessError(id, error, ctx, started) {
    const durationMs = ctx.now() - started;
    if (error instanceof JsonRpcRemoteError) {
        const layer = resolveErrorLayer(error, 'tools/call');
        return fail(id, 'robustness', TestLevel.Robustness, layer, 'jsonrpc-error', `server rejected the call: ${error.message}`, {
            transport: ctx.transport,
            durationMs,
            evidence: { code: error.code },
        });
    }
    return fail(id, 'robustness', TestLevel.Robustness, resolveErrorLayer(error, 'tools/call'), 'exception', error instanceof Error ? error.message : String(error), {
        transport: ctx.transport,
        durationMs,
    });
}
//# sourceMappingURL=robustness.js.map