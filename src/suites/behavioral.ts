import { JsonRpcRemoteError } from '../core/jsonrpc/multiplexer.js';
import type { ToolDefinition } from '../core/primitives/types.js';
import { TestLevel, type TestResult } from '../core/types/test-result.js';
import type { SuiteContext } from '../engine/ctx.js';
import { fail, pass, resolveErrorLayer, skip, warn } from '../engine/result.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultText(result: unknown): string {
  const r = result as Record<string, unknown> | undefined;
  if (r === undefined) return '';
  const content = r['content'];
  if (Array.isArray(content)) {
    return content
      .map((c) => (isRecord(c) && typeof c['text'] === 'string' ? (c['text'] as string) : ''))
      .join('');
  }
  return '';
}

function hasTool(tools: ToolDefinition[], name: string): boolean {
  return tools.some((t) => t.name === name);
}

/** Pick a tool that round-trips an arbitrary string argument so we can verify
 * payload fidelity across transports. Prefers `big_echo` (body-only echo, no
 * header mirroring) so huge payloads stay in the request body; falls back to
 * `delete_file` (which echoes its `path`). */
function pickRoundTripTool(
  tools: ToolDefinition[],
): { name: string; argKey: string; extra: Record<string, unknown> } | undefined {
  if (hasTool(tools, 'big_echo')) return { name: 'big_echo', argKey: 'data', extra: {} };
  if (hasTool(tools, 'delete_file')) return { name: 'delete_file', argKey: 'path', extra: {} };
  return undefined;
}

async function callSum(
  ctx: SuiteContext,
  a: number,
  b: number,
  timeoutMs: number,
): Promise<number> {
  const result = (await ctx.adapter.request(
    'tools/call',
    { name: 'sum', arguments: { a, b } },
    timeoutMs,
  )) as Record<string, unknown>;
  const text = resultText(result);
  const parsed = Number.parseInt(text, 10);
  return Number.isNaN(parsed) ? NaN : parsed;
}

export async function runBehavioralSuite(ctx: SuiteContext): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const transport = ctx.transport;
  const tools = ctx.shared.tools;
  const reqTimeout = ctx.options.requestTimeoutMs ?? ctx.options.defaultTimeoutMs;

  if (!hasTool(tools, 'sum')) {
    results.push(
      skip('behavioral concurrency', 'behavioral', TestLevel.Behavioral, 'no sum tool discovered', {
        transport,
        durationMs: 0,
      }),
    );
  } else {
    const N = 8;
    const started = ctx.now();
    try {
      const calls = Array.from({ length: N }, (_, i) => callSum(ctx, i, i * 2, reqTimeout));
      const sums = await Promise.all(calls);
      const mismatches = sums
        .map((value, i) => ({ value, expected: i + i * 2 }))
        .filter((m) => m.value !== m.expected);
      const durationMs = ctx.now() - started;
      if (mismatches.length === 0) {
        results.push(
          pass('behavioral concurrency parallel', 'behavioral', TestLevel.Behavioral, {
            transport,
            durationMs,
            evidence: { calls: N, multiplexerPending: ctx.adapter.mux.pendingCount },
          }),
        );
      } else {
        results.push(
          fail(
            'behavioral concurrency parallel',
            'behavioral',
            TestLevel.Behavioral,
            'application',
            'response-mismatch',
            `${mismatches.length}/${N} parallel calls returned a result that did not match its request`,
            { transport, durationMs, evidence: { mismatches: mismatches.slice(0, 5) } },
          ),
        );
      }
    } catch (error) {
      results.push(fromBehavioralError('behavioral concurrency parallel', error, ctx, started));
    }
  }

  results.push(
    ctx.adapter.mux.pendingCount === 0
      ? pass('behavioral mux clean', 'behavioral', TestLevel.Behavioral, {
          transport,
          durationMs: 0,
          evidence: { pending: ctx.adapter.mux.pendingCount },
        })
      : warn(
          'behavioral mux clean',
          'behavioral',
          TestLevel.Behavioral,
          `multiplexer has ${ctx.adapter.mux.pendingCount} pending entries after the suite`,
          {
            transport,
            durationMs: 0,
            evidence: { pending: ctx.adapter.mux.pendingCount },
          },
        ),
  );

  const rt = pickRoundTripTool(tools);
  if (rt === undefined) {
    results.push(
      skip(
        'behavioral payload round-trip',
        'behavioral',
        TestLevel.Behavioral,
        'no echo/delete_file tool discovered',
        { transport, durationMs: 0 },
      ),
    );
  } else {
    const cases: Array<{ id: string; value: string }> = [
      { id: 'behavioral payload huge', value: 'x'.repeat(256 * 1024) },
      { id: 'behavioral payload unicode', value: 'héllo ωorld 日本語 🚀🔥💡 𝒳𝒴𝒵' },
      { id: 'behavioral payload binary', value: Buffer.from('some raw bytes').toString('base64') },
    ];
    for (const c of cases) {
      const started = ctx.now();
      try {
        const result = (await ctx.adapter.request(
          'tools/call',
          { name: rt.name, arguments: { ...rt.extra, [rt.argKey]: c.value } },
          reqTimeout,
        )) as Record<string, unknown>;
        const text = resultText(result);
        const durationMs = ctx.now() - started;
        if (text.includes(c.value)) {
          results.push(
            pass(c.id, 'behavioral', TestLevel.Behavioral, {
              transport,
              durationMs,
              evidence: { bytes: c.value.length },
            }),
          );
        } else {
          results.push(
            fail(
              c.id,
              'behavioral',
              TestLevel.Behavioral,
              'application',
              'payload-mismatch',
              'server did not echo the exact payload back',
              {
                transport,
                durationMs,
                evidence: { sentBytes: c.value.length, receivedBytes: text.length },
              },
            ),
          );
        }
      } catch (error) {
        results.push(fromBehavioralError(c.id, error, ctx, started));
      }
    }
  }

  if (
    !hasTool(tools, 'sum') ||
    ctx.shared.resources.length === 0 ||
    ctx.shared.prompts.length === 0
  ) {
    results.push(
      skip(
        'behavioral concurrent mixed',
        'behavioral',
        TestLevel.Behavioral,
        'insufficient discovered primitives',
        { transport, durationMs: 0 },
      ),
    );
  } else {
    const started = ctx.now();
    try {
      const [tl, rl, pl, sum] = await Promise.all([
        ctx.adapter.request('tools/list', undefined, reqTimeout),
        ctx.adapter.request('resources/list', undefined, reqTimeout),
        ctx.adapter.request('prompts/list', undefined, reqTimeout),
        callSum(ctx, 2, 5, reqTimeout),
      ]);
      const ok =
        isRecord(tl) &&
        Array.isArray(tl.tools) &&
        isRecord(rl) &&
        Array.isArray(rl.resources) &&
        isRecord(pl) &&
        Array.isArray(pl.prompts) &&
        sum === 7;
      const durationMs = ctx.now() - started;
      results.push(
        ok
          ? pass('behavioral concurrent mixed', 'behavioral', TestLevel.Behavioral, {
              transport,
              durationMs,
            })
          : fail(
              'behavioral concurrent mixed',
              'behavioral',
              TestLevel.Behavioral,
              'application',
              'concurrent-mismatch',
              'a concurrently-issued primitive call returned an unexpected result',
              { transport, durationMs },
            ),
      );
    } catch (error) {
      results.push(fromBehavioralError('behavioral concurrent mixed', error, ctx, started));
    }
  }

  return results;
}

function fromBehavioralError(
  id: string,
  error: unknown,
  ctx: SuiteContext,
  started: number,
): TestResult {
  const durationMs = ctx.now() - started;
  if (error instanceof JsonRpcRemoteError) {
    const layer = resolveErrorLayer(error, 'tools/call');
    return fail(
      id,
      'behavioral',
      TestLevel.Behavioral,
      layer,
      'jsonrpc-error',
      `server rejected the call: ${error.message}`,
      {
        transport: ctx.transport,
        durationMs,
        evidence: { code: error.code },
      },
    );
  }
  return fail(
    id,
    'behavioral',
    TestLevel.Behavioral,
    resolveErrorLayer(error, 'tools/call'),
    'exception',
    error instanceof Error ? error.message : String(error),
    {
      transport: ctx.transport,
      durationMs,
    },
  );
}
