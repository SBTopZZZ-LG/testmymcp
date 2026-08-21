import {
  type PromptDefinition,
  type ResourceDefinition,
  type ResourceTemplateDefinition,
  type ToolDefinition,
} from '../core/primitives/types.js';
import { isValidSchema } from '../core/schemas/validator.js';
import type { TransportType } from '../core/types/protocol.js';
import { TestLevel, type TestResult } from '../core/types/test-result.js';
import type { SuiteContext } from '../engine/ctx.js';
import { fromError, pass, skip, warn } from '../engine/result.js';
import { validateToolHeaders } from '../transports/http/x-mcp-header.js';

interface ListResult {
  items: unknown[];
  pages: number;
  looped: boolean;
  truncated: boolean;
  /** Raw first-page result, used to inspect cache hints (ttlMs/cacheScope). */
  firstRaw?: Record<string, unknown>;
}

async function collectList(
  ctx: SuiteContext,
  method: string,
  itemKey: string,
  params: object | undefined,
): Promise<ListResult> {
  const maxPages = ctx.options.maxPaginationPages ?? 10;
  const requestTimeout = ctx.options.requestTimeoutMs ?? ctx.options.defaultTimeoutMs;
  const items: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  let firstRaw: Record<string, unknown> | undefined;
  for (;;) {
    pages += 1;
    if (pages > maxPages) return { items, pages, looped: false, truncated: true, firstRaw };
    const callParams = cursor !== undefined ? { ...(params ?? {}), cursor } : params;
    const data = (await ctx.adapter.request(method, callParams, requestTimeout)) as Record<
      string,
      unknown
    >;
    if (firstRaw === undefined) firstRaw = data;
    const batch = Array.isArray(data[itemKey]) ? data[itemKey] : [];
    for (const item of batch) items.push(item);
    const next = typeof data.nextCursor === 'string' ? data.nextCursor : undefined;
    if (next === undefined) return { items, pages, looped: false, truncated: false, firstRaw };
    if (seenCursors.has(next)) return { items, pages, looped: true, truncated: false, firstRaw };
    seenCursors.add(next);
    cursor = next;
  }
}

/**
 * Validate the optional cache hints on a list/read result. Absence is reported
 * as a warning (caching hints are recommended); when present, `ttlMs` must be a
 * non-negative integer and `cacheScope` one of `public`/`private`.
 */
function checkCaching(
  id: string,
  raw: Record<string, unknown> | undefined,
  results: TestResult[],
  transport: TransportType,
): void {
  if (!isRecord(raw)) return;
  const ttl = raw.ttlMs;
  const scope = raw.cacheScope;
  if (ttl === undefined && scope === undefined) {
    results.push(
      warn(
        `${id} caching-hint`,
        'discovery',
        TestLevel.Discovery,
        'list result omits ttlMs/cacheScope caching hints',
        {
          transport,
          durationMs: 0,
        },
      ),
    );
    return;
  }
  if (ttl !== undefined && (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < 0)) {
    results.push(
      warn(
        `${id} caching-ttl`,
        'discovery',
        TestLevel.Discovery,
        `ttlMs is not a non-negative integer: ${JSON.stringify(ttl)}`,
        {
          transport,
          durationMs: 0,
          evidence: raw,
        },
      ),
    );
  }
  if (scope !== undefined && scope !== 'public' && scope !== 'private') {
    results.push(
      warn(
        `${id} caching-scope`,
        'discovery',
        TestLevel.Discovery,
        `cacheScope is not "public"/"private": ${JSON.stringify(scope)}`,
        {
          transport,
          durationMs: 0,
          evidence: raw,
        },
      ),
    );
  }
  results.push(
    pass(`${id} caching`, 'discovery', TestLevel.Discovery, {
      transport,
      durationMs: 0,
      evidence: { ttlMs: ttl, cacheScope: scope },
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const URI_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export async function runDiscoverySuite(ctx: SuiteContext): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const transport = ctx.transport;

  if (ctx.shared.session === undefined) {
    results.push(
      skip('discovery skipped', 'discovery', TestLevel.Discovery, 'no negotiated session', {
        transport,
        durationMs: 0,
      }),
    );
    return results;
  }
  const caps = ctx.shared.session.serverCapabilities;

  const maxSchemaBytes = ctx.options.maxSchemaBytes ?? 1024 * 1024;
  const requestTimeout = ctx.options.requestTimeoutMs ?? ctx.options.defaultTimeoutMs;

  if (caps.tools) {
    try {
      const list = await collectList(ctx, 'tools/list', 'tools', undefined);
      const tools: ToolDefinition[] = [];
      const names = new Set<string>();
      let duplicateNames = 0;
      for (const raw of list.items) {
        if (!isRecord(raw)) continue;
        const name = typeof raw.name === 'string' ? raw.name.trim() : '';
        if (name === '') {
          results.push(
            warn(
              'tools/list item-name',
              'discovery',
              TestLevel.Discovery,
              'tool without a name string',
              {
                transport,
                durationMs: 0,
                evidence: raw,
              },
            ),
          );
          continue;
        }
        if (names.has(name)) duplicateNames += 1;
        names.add(name);
        const headerCheck =
          raw.inputSchema === undefined || raw.inputSchema === null
            ? undefined
            : validateToolHeaders(raw.inputSchema);
        if (headerCheck && !headerCheck.valid) {
          results.push(
            warn(
              `tools/list x-mcp-header ${name}`,
              'discovery',
              TestLevel.Discovery,
              `invalid x-mcp-header annotation: ${headerCheck.reason}`,
              { transport, durationMs: 0 },
            ),
          );
          continue;
        }
        tools.push({
          name,
          description: typeof raw.description === 'string' ? raw.description : undefined,
          inputSchema: raw.inputSchema,
          annotations: raw.annotations,
        });
      }
      if (duplicateNames > 0) {
        results.push(
          warn(
            'tools/list duplicate-names',
            'discovery',
            TestLevel.Discovery,
            `${duplicateNames} duplicate tool name(s)`,
            {
              transport,
              durationMs: 0,
            },
          ),
        );
      }
      if (list.looped) {
        results.push(
          warn(
            'tools/list pagination-loop',
            'discovery',
            TestLevel.Discovery,
            'nextCursor repeated its value (pagination loop)',
            {
              transport,
              durationMs: 0,
            },
          ),
        );
      }
      if (list.truncated) {
        results.push(
          warn(
            'tools/list pagination-truncated',
            'discovery',
            TestLevel.Discovery,
            `pagination did not terminate; capped at ${list.pages} pages`,
            { transport, durationMs: 0 },
          ),
        );
      }
      results.push(
        pass('tools/list', 'discovery', TestLevel.Discovery, {
          transport,
          durationMs: 0,
          evidence: { count: tools.length, pages: list.pages },
        }),
      );
      checkCaching('tools/list', list.firstRaw, results, transport);
      ctx.shared.tools = tools;
      setToolSchemas(ctx, tools);

      for (const tool of tools) {
        if (tool.inputSchema === undefined || tool.inputSchema === null) continue;
        const check = isValidSchema(tool.inputSchema, maxSchemaBytes);
        if (!check.valid) {
          results.push(
            warn(
              `tools/list schema ${tool.name}`,
              'discovery',
              TestLevel.Discovery,
              `invalid inputSchema: ${check.errors[0] ?? 'unknown error'}`,
              { transport, durationMs: 0, evidence: tool.inputSchema },
            ),
          );
        }
      }
    } catch (error) {
      results.push(
        fromError('tools/list', 'discovery', TestLevel.Discovery, error, 'protocol', {
          transport,
          durationMs: 0,
          warnings: ['tools/list failed; tool capability tests will be skipped'],
        }),
      );
      ctx.shared.tools = [];
    }
  } else {
    results.push(
      skip('tools/list', 'discovery', TestLevel.Discovery, 'server does not advertise tools', {
        transport,
        durationMs: 0,
      }),
    );
  }

  if (caps.resources) {
    try {
      const list = await collectList(ctx, 'resources/list', 'resources', undefined);
      const resources: ResourceDefinition[] = [];
      for (const raw of list.items) {
        if (!isRecord(raw)) continue;
        const uri = typeof raw.uri === 'string' ? raw.uri : '';
        if (uri === '') {
          results.push(
            warn(
              'resources/list item-uri',
              'discovery',
              TestLevel.Discovery,
              'resource without a uri string',
              {
                transport,
                durationMs: 0,
                evidence: raw,
              },
            ),
          );
          continue;
        }
        if (!URI_SCHEME.test(uri)) {
          results.push(
            warn(
              'resources/list item-scheme',
              'discovery',
              TestLevel.Discovery,
              `resource uri has no recognized scheme: ${uri}`,
              {
                transport,
                durationMs: 0,
              },
            ),
          );
        }
        resources.push({
          uri,
          name: typeof raw.name === 'string' ? raw.name : undefined,
          description: typeof raw.description === 'string' ? raw.description : undefined,
          mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : undefined,
        });
      }
      ctx.shared.resources = resources;
      if (list.truncated) {
        results.push(
          warn(
            'resources/list pagination-truncated',
            'discovery',
            TestLevel.Discovery,
            `pagination did not terminate; capped at ${list.pages} pages`,
            { transport, durationMs: 0 },
          ),
        );
      }
      results.push(
        pass('resources/list', 'discovery', TestLevel.Discovery, {
          transport,
          durationMs: 0,
          evidence: { count: resources.length },
        }),
      );
      checkCaching('resources/list', list.firstRaw, results, transport);
    } catch (error) {
      results.push(
        fromError('resources/list', 'discovery', TestLevel.Discovery, error, 'protocol', {
          transport,
          durationMs: 0,
        }),
      );
    }

    try {
      const templates = await collectList(
        ctx,
        'resources/templates/list',
        'resourceTemplates',
        undefined,
      );
      const parsedTemplates: ResourceTemplateDefinition[] = [];
      for (const raw of templates.items) {
        if (!isRecord(raw)) continue;
        const uriTemplate = typeof raw.uriTemplate === 'string' ? raw.uriTemplate : '';
        if (uriTemplate === '' || !uriTemplate.includes('{') || !uriTemplate.includes('}')) {
          results.push(
            warn(
              'resources/templates item-template',
              'discovery',
              TestLevel.Discovery,
              `resource template is not a valid URI template: ${uriTemplate || '<missing>'}`,
              { transport, durationMs: 0, evidence: raw },
            ),
          );
        }
        parsedTemplates.push({
          uriTemplate,
          name: typeof raw.name === 'string' ? raw.name : undefined,
          description: typeof raw.description === 'string' ? raw.description : undefined,
        });
      }
      ctx.shared.resourceTemplates = parsedTemplates;
      checkCaching('resources/templates/list', templates.firstRaw, results, transport);
    } catch (error) {
      const remote = error instanceof Error ? error.message : String(error);
      if (remote.includes('method not found')) {
        results.push(
          warn(
            'resources/templates/list',
            'discovery',
            TestLevel.Discovery,
            'server does not support resource templates',
            {
              transport,
              durationMs: 0,
            },
          ),
        );
      } else {
        results.push(
          fromError(
            'resources/templates/list',
            'discovery',
            TestLevel.Discovery,
            error,
            'protocol',
            { transport, durationMs: 0 },
          ),
        );
      }
    }
  } else {
    results.push(
      skip('resources', 'discovery', TestLevel.Discovery, 'server does not advertise resources', {
        transport,
        durationMs: 0,
      }),
    );
  }

  if (caps.prompts) {
    try {
      const list = await collectList(ctx, 'prompts/list', 'prompts', undefined);
      const prompts: PromptDefinition[] = [];
      const names = new Set<string>();
      for (const raw of list.items) {
        if (!isRecord(raw)) continue;
        const name = typeof raw.name === 'string' ? raw.name.trim() : '';
        if (name === '') {
          results.push(
            warn(
              'prompts/list item-name',
              'discovery',
              TestLevel.Discovery,
              'prompt without a name string',
              {
                transport,
                durationMs: 0,
              },
            ),
          );
          continue;
        }
        if (names.has(name)) {
          results.push(
            warn(
              'prompts/list duplicate-names',
              'discovery',
              TestLevel.Discovery,
              `duplicate prompt name: ${name}`,
              { transport, durationMs: 0 },
            ),
          );
        }
        names.add(name);
        prompts.push({
          name,
          description: typeof raw.description === 'string' ? raw.description : undefined,
          arguments: Array.isArray(raw.arguments)
            ? raw.arguments
                .filter(isRecord)
                .map((arg) => ({
                  name: typeof arg.name === 'string' ? arg.name : '',
                  description: typeof arg.description === 'string' ? arg.description : undefined,
                  required: arg.required === true,
                }))
                .filter((arg) => arg.name !== '')
            : undefined,
        });
      }
      ctx.shared.prompts = prompts;
      if (list.truncated) {
        results.push(
          warn(
            'prompts/list pagination-truncated',
            'discovery',
            TestLevel.Discovery,
            `pagination did not terminate; capped at ${list.pages} pages`,
            { transport, durationMs: 0 },
          ),
        );
      }
      results.push(
        pass('prompts/list', 'discovery', TestLevel.Discovery, {
          transport,
          durationMs: 0,
          evidence: { count: prompts.length },
        }),
      );
      checkCaching('prompts/list', list.firstRaw, results, transport);
    } catch (error) {
      results.push(
        fromError('prompts/list', 'discovery', TestLevel.Discovery, error, 'protocol', {
          transport,
          durationMs: 0,
        }),
      );
    }
  } else {
    results.push(
      skip('prompts', 'discovery', TestLevel.Discovery, 'server does not advertise prompts', {
        transport,
        durationMs: 0,
      }),
    );
  }

  if (caps.completions) {
    const promptName = ctx.shared.prompts[0]?.name;
    if (promptName !== undefined) {
      try {
        const completion = (await ctx.adapter.request(
          'completion/complete',
          {
            ref: { type: 'ref/prompt', name: promptName },
            argument: { name: 'who', value: '' },
          },
          requestTimeout,
        )) as Record<string, unknown>;
        const values =
          isRecord(completion.completion) && Array.isArray(completion.completion.values)
            ? completion.completion.values
            : [];
        if (values.length > 100) {
          results.push(
            warn(
              'completion/complete',
              'discovery',
              TestLevel.Discovery,
              `completion returned ${values.length} suggestions (limit is 100)`,
              {
                transport,
                durationMs: 0,
              },
            ),
          );
        } else {
          results.push(
            pass('completion/complete', 'discovery', TestLevel.Discovery, {
              transport,
              durationMs: 0,
              evidence: { suggestions: values.length },
            }),
          );
        }
      } catch (error) {
        results.push(
          fromError('completion/complete', 'discovery', TestLevel.Discovery, error, 'protocol', {
            transport,
            durationMs: 0,
          }),
        );
      }
    } else {
      results.push(
        skip(
          'completion/complete',
          'discovery',
          TestLevel.Discovery,
          'no prompt available to complete',
          { transport, durationMs: 0 },
        ),
      );
    }
  } else {
    results.push(
      skip('completion', 'discovery', TestLevel.Discovery, 'server does not advertise completion', {
        transport,
        durationMs: 0,
      }),
    );
  }

  return results;
}

function setToolSchemas(ctx: SuiteContext, tools: readonly ToolDefinition[]): void {
  const setter = (
    ctx.adapter as { setToolSchemas?(s: Array<{ name: string; inputSchema?: unknown }>): void }
  ).setToolSchemas;
  if (typeof setter === 'function') {
    setter.call(
      ctx.adapter,
      tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema })),
    );
  }
}
