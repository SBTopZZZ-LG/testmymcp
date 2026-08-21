import { JsonRpcRemoteError } from '../core/jsonrpc/multiplexer.js';
import { generateValidInput, isValidSchema, validateAgainstSchema, } from '../core/schemas/validator.js';
import { classifyTool, executionDecision } from '../core/tools/safety.js';
import { TestLevel } from '../core/types/test-result.js';
import { fail, pass, resolveErrorLayer, skip, warn } from '../engine/result.js';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
async function invokeTool(ctx, tool, input) {
    const started = ctx.now();
    const toolTimeout = ctx.options.toolTimeoutMs ?? ctx.options.defaultTimeoutMs;
    try {
        const result = (await ctx.adapter.request('tools/call', { name: tool.name, arguments: input }, toolTimeout));
        // Tasks extension: a tool may return a `task` result that must be polled to
        // completion. Only modern adapters expose pollTask; others treat it as a pass.
        const taskId = isRecord(result) && result.resultType === 'task' ? result.taskId : undefined;
        if (typeof taskId === 'string') {
            const poller = ctx.adapter.pollTask;
            if (typeof poller === 'function') {
                const final = (await poller.call(ctx.adapter, taskId, {
                    maxPollMs: toolTimeout,
                }));
                const finalState = typeof final.status === 'string' ? final.status : 'unknown';
                if (finalState === 'completed') {
                    return {
                        durationMs: ctx.now() - started,
                        outcome: {
                            status: 'pass',
                            reason: 'tool returned a task that completed',
                            evidence: { taskId, finalState, final },
                        },
                    };
                }
                if (finalState === 'failed' || finalState === 'cancelled') {
                    return {
                        durationMs: ctx.now() - started,
                        outcome: {
                            status: 'warn',
                            layer: 'application',
                            reason: `tool task ended in "${finalState}"`,
                            evidence: { taskId, finalState, final },
                        },
                    };
                }
                return {
                    durationMs: ctx.now() - started,
                    outcome: {
                        status: 'warn',
                        layer: 'application',
                        reason: `tool task did not reach a terminal status (last: "${finalState}")`,
                        evidence: { taskId, finalState, final },
                    },
                };
            }
        }
        if (isRecord(result) && result.isError === true) {
            return {
                durationMs: ctx.now() - started,
                outcome: {
                    status: 'warn',
                    layer: 'application',
                    reason: `tool executed but returned isError=${true}`,
                    evidence: result,
                },
            };
        }
        return {
            durationMs: ctx.now() - started,
            outcome: {
                status: 'pass',
                reason: 'tool call returned a result',
                evidence: result,
            },
        };
    }
    catch (error) {
        if (error instanceof JsonRpcRemoteError) {
            const layer = resolveErrorLayer(error, 'tools/call');
            return {
                durationMs: ctx.now() - started,
                outcome: {
                    status: layer === 'application' ? 'warn' : 'fail',
                    layer,
                    reason: `server rejected the call: ${error.message}`,
                    evidence: { code: error.code },
                },
            };
        }
        const layer = resolveErrorLayer(error, 'tools/call');
        return {
            durationMs: ctx.now() - started,
            outcome: {
                status: 'fail',
                layer,
                reason: error instanceof Error ? error.message : String(error),
            },
        };
    }
}
export async function runCapabilitySuite(ctx) {
    const results = [];
    const transport = 'stdio';
    const tools = ctx.shared.tools;
    if (tools.length === 0) {
        results.push(skip('capability tools', 'capability', TestLevel.Capability, 'no tools discovered', {
            transport,
            durationMs: 0,
        }));
        return results;
    }
    const maxSchemaBytes = ctx.options.maxSchemaBytes ?? 1024 * 1024;
    const maxCalls = ctx.options.maxCallsPerTool ?? 1;
    for (const tool of tools) {
        const testId = `tools/call ${tool.name}`;
        const risk = classifyTool(tool);
        const decision = executionDecision(risk, ctx.options.mode);
        if (!decision.run) {
            results.push(skip(testId, 'capability', TestLevel.Capability, decision.reason ?? 'skipped by execution policy', {
                transport,
                durationMs: 0,
                evidence: { risk },
            }));
            continue;
        }
        if (tool.inputSchema === undefined || tool.inputSchema === null) {
            const { outcome, durationMs } = await invokeTool(ctx, tool, {});
            results.push(toResult(testId, outcome, { risk, durationMs, transport, hasSchema: false }));
            continue;
        }
        const schemaCheck = isValidSchema(tool.inputSchema, maxSchemaBytes);
        if (!schemaCheck.valid) {
            results.push(warn(`${testId} schema`, 'capability', TestLevel.Capability, `invalid inputSchema: ${schemaCheck.errors[0] ?? 'unknown error'}`, {
                transport,
                durationMs: 0,
            }));
            continue;
        }
        const input = generateValidInput(tool.inputSchema, 4);
        const check = validateAgainstSchema(tool.inputSchema, input === undefined ? {} : input, maxSchemaBytes);
        if (input === undefined || !check.valid) {
            results.push(warn(`${testId} input-gen`, 'capability', TestLevel.Capability, `could not generate a schema-valid input${check.valid ? '' : `: ${check.errors[0] ?? 'unknown error'}`}`, { transport, durationMs: 0 }));
            continue;
        }
        for (let call = 0; call < maxCalls; call += 1) {
            const { outcome, durationMs } = await invokeTool(ctx, tool, input);
            const label = maxCalls > 1 ? `${testId} #${call + 1}` : testId;
            results.push(toResult(label, outcome, { risk, durationMs, transport, hasSchema: true }));
        }
    }
    return results;
}
function toResult(id, outcome, ctx) {
    const extras = {
        transport: ctx.transport,
        durationMs: ctx.durationMs,
        evidence: { ...outcome.evidence, risk: ctx.risk },
    };
    switch (outcome.status) {
        case 'pass':
            return pass(id, 'capability', TestLevel.Capability, extras);
        case 'warn':
            return warn(id, 'capability', TestLevel.Capability, outcome.reason, extras);
        case 'fail':
            return fail(id, 'capability', TestLevel.Capability, outcome.layer ?? 'transport', 'tools/call', outcome.reason, extras);
    }
}
//# sourceMappingURL=capability.js.map