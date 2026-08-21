import { TestLevel, type TestResult } from '../core/types/test-result.js';
import { classifyTool, executionDecision, type ToolRisk } from '../core/tools/safety.js';
import { generateValidInput, isValidSchema, validateAgainstSchema } from '../core/schemas/validator.js';
import { JsonRpcRemoteError } from '../core/jsonrpc/multiplexer.js';
import { pass, warn, fail, skip, resolveErrorLayer } from '../engine/result.js';
import type { SuiteContext } from '../engine/ctx.js';
import type { ToolDefinition } from '../core/primitives/types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface CallOutcome {
  status: 'pass' | 'warn' | 'fail';
  layer?: 'transport' | 'jsonrpc' | 'protocol' | 'application';
  reason: string;
  evidence?: unknown;
}

async function invokeTool(
  ctx: SuiteContext,
  tool: ToolDefinition,
  input: unknown,
): Promise<{ outcome: CallOutcome; durationMs: number }> {
  const started = ctx.now();
  const toolTimeout = ctx.options.toolTimeoutMs ?? ctx.options.defaultTimeoutMs;
  try {
    const result = (await ctx.adapter.request('tools/call', { name: tool.name, arguments: input }, toolTimeout)) as Record<string, unknown>;
    // Tasks extension: a tool may return a `task` result that must be polled to
    // completion. Only modern adapters expose pollTask; others treat it as a pass.
    const taskId = isRecord(result) && result.resultType === 'task' ? result.taskId : undefined;
    if (typeof taskId === 'string') {
      const poller = (ctx.adapter as { pollTask?(taskId: string, options?: { maxPollMs?: number }): Promise<unknown> }).pollTask;
      if (typeof poller === 'function') {
        const final = (await poller.call(ctx.adapter, taskId, { maxPollMs: toolTimeout })) as Record<string, unknown>;
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
  } catch (error) {
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
      outcome: { status: 'fail', layer, reason: error instanceof Error ? error.message : String(error) },
    };
  }
}

export async function runCapabilitySuite(ctx: SuiteContext): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const transport = 'stdio';
  const tools = ctx.shared.tools;

  if (tools.length === 0) {
    results.push(skip('capability tools', 'capability', TestLevel.Capability, 'no tools discovered', { transport, durationMs: 0 }));
    return results;
  }

  const maxSchemaBytes = ctx.options.maxSchemaBytes ?? 1024 * 1024;
  const maxCalls = ctx.options.maxCallsPerTool ?? 1;

  for (const tool of tools) {
    const testId = `tools/call ${tool.name}`;
    const risk = classifyTool(tool);
    const decision = executionDecision(risk, ctx.options.mode);
    if (!decision.run) {
      results.push(
        skip(testId, 'capability', TestLevel.Capability, decision.reason ?? 'skipped by execution policy', {
          transport,
          durationMs: 0,
          evidence: { risk } satisfies { risk: ToolRisk },
        }),
      );
      continue;
    }

    if (tool.inputSchema === undefined || tool.inputSchema === null) {
      const { outcome, durationMs } = await invokeTool(ctx, tool, {});
      results.push(
        toResult(testId, outcome, { risk, durationMs, transport, hasSchema: false }),
      );
      continue;
    }

    const schemaCheck = isValidSchema(tool.inputSchema, maxSchemaBytes);
    if (!schemaCheck.valid) {
      results.push(
        warn(`${testId} schema`, 'capability', TestLevel.Capability, `invalid inputSchema: ${schemaCheck.errors[0] ?? 'unknown error'}`, {
          transport,
          durationMs: 0,
        }),
      );
      continue;
    }

    const input = generateValidInput(tool.inputSchema, 4);
    const check = validateAgainstSchema(tool.inputSchema, input === undefined ? {} : input, maxSchemaBytes);

    if (input === undefined || !check.valid) {
      results.push(
        warn(
          `${testId} input-gen`,
          'capability',
          TestLevel.Capability,
          `could not generate a schema-valid input${check.valid ? '' : `: ${check.errors[0] ?? 'unknown error'}`}`,
          { transport, durationMs: 0 },
        ),
      );
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

function toResult(
  id: string,
  outcome: { status: 'pass' | 'warn' | 'fail'; layer?: 'transport' | 'jsonrpc' | 'protocol' | 'application'; reason: string; evidence?: unknown },
  ctx: { risk: ToolRisk; durationMs: number; transport: string; hasSchema: boolean },
): TestResult {
  const extras = {
    transport: ctx.transport as 'stdio',
    durationMs: ctx.durationMs,
    evidence: { ...(outcome.evidence as Record<string, unknown> | undefined), risk: ctx.risk },
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