import { describe, expect, it } from 'vitest';

import { emptyClientCapabilities } from '../../src/core/protocol/capabilities.js';
import {
  parseDiscoverResult,
  selectSupportedVersion,
} from '../../src/protocols/modern/discover.js';
import {
  buildInputResponse,
  buildInputRetryParams,
  isInputRequiredResult,
  parseInputRequests,
  parseRequestState,
} from '../../src/protocols/modern/mrtr.js';
import { buildRequestMeta, withRequestMeta } from '../../src/protocols/modern/request-meta.js';
import { isTaskResult } from '../../src/protocols/modern/result.js';

describe('modern request-meta', () => {
  it('builds per-request meta with required fields', () => {
    const meta = buildRequestMeta({
      protocolVersion: '2026-07-28',
      clientInfo: { name: 'testmymcp', version: '0.1.0' },
      clientCapabilities: {
        ...emptyClientCapabilities(),
        elicitation: true,
        elicitationForm: true,
      },
    });
    expect(meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28');
    expect(meta['io.modelcontextprotocol/clientInfo']).toEqual({
      name: 'testmymcp',
      version: '0.1.0',
    });
    const caps = meta['io.modelcontextprotocol/clientCapabilities'] as Record<string, unknown>;
    expect(caps.elicitation).toEqual({ form: {} });
  });

  it('withRequestMeta merges params and injects _meta', () => {
    const out = withRequestMeta(
      { name: 'x', arguments: {} },
      {
        protocolVersion: '2026-07-28',
        clientInfo: {},
        clientCapabilities: emptyClientCapabilities(),
      },
    );
    expect(out?.name).toBe('x');
    expect(out?._meta).toBeDefined();
  });
});

describe('modern discover', () => {
  it('parses discover result incl capabilities + extensions', () => {
    const parsed = parseDiscoverResult({
      resultType: 'complete',
      supportedVersions: ['2026-07-28', '2025-11-25'],
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true },
        extensions: { 'io.modelcontextprotocol/tasks': {} },
      },
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 's', version: '1' } },
      ttlMs: 60000,
      cacheScope: 'public',
    });
    expect(parsed.supportedVersions).toEqual(['2026-07-28', '2025-11-25']);
    expect(parsed.capabilities.tools).toBe(true);
    expect(parsed.capabilities.toolListChanged).toBe(true);
    expect(parsed.capabilities.resourceSubscribe).toBe(true);
    expect(parsed.capabilities.extensions?.['io.modelcontextprotocol/tasks']).toEqual({});
    expect(parsed.serverInfo.name).toBe('s');
    expect(parsed.cacheScope).toBe('public');
  });

  it('selects preferred supported version else modern default', () => {
    expect(selectSupportedVersion(['2026-07-28'], '2026-07-28')).toBe('2026-07-28');
    expect(selectSupportedVersion(['2025-11-25', '2026-07-28'], '2026-07-28')).toBe('2026-07-28');
    expect(selectSupportedVersion(['2025-11-25'], '2026-07-28')).toBe('2025-11-25');
    expect(selectSupportedVersion([], '2026-07-28')).toBeUndefined();
  });
});

describe('modern mrtr', () => {
  const inputRequired = {
    resultType: 'input_required',
    inputRequests: { confirm: { method: 'elicitation/create', params: {} } },
    requestState: 'opaque-state',
  };

  it('detects input_required results and extracts requests/state', () => {
    expect(isInputRequiredResult(inputRequired)).toBe(true);
    expect(parseInputRequests(inputRequired)).toBeDefined();
    expect(parseRequestState(inputRequired)).toBe('opaque-state');
  });

  it('treats absent resultType as complete (not input_required)', () => {
    expect(isInputRequiredResult({ tools: [] })).toBe(false);
  });

  it('builds retry params echoing requestState + inputResponses', () => {
    const out = buildInputRetryParams(
      { name: 'x', arguments: {} },
      { confirm: { action: 'accept', content: {} } },
      'opaque-state',
    );
    expect(out.requestState).toBe('opaque-state');
    expect(out.inputResponses).toEqual({ confirm: { action: 'accept', content: {} } });
    expect(out.name).toBe('x');
  });

  it('task result type detected as task', () => {
    expect(isTaskResult({ resultType: 'task', taskId: 't1' })).toBe(true);
  });

  describe('buildInputResponse fidelity', () => {
    it('answers elicitation/create with sample content from the schema', () => {
      const out = buildInputResponse('elicitation/create', {
        requestedSchema: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, name: { type: 'string' }, n: { type: 'integer' } },
        },
      });
      expect(out.action).toBe('accept');
      expect(out.content).toEqual({ ok: true, name: '', n: 0 });
    });

    it('answers sampling/createMessage with a minimal message', () => {
      const out = buildInputResponse('sampling/createMessage', {});
      expect(out.action).toBe('accept');
      expect(out.content).toMatchObject({ role: 'user' });
    });

    it('answers roots/list with an empty root list', () => {
      const out = buildInputResponse('roots/list', {});
      expect(out).toEqual({ action: 'accept', roots: [] });
    });

    it('falls back to accept with empty content for unknown methods', () => {
      const out = buildInputResponse('unknown/method', {});
      expect(out).toEqual({ action: 'accept', content: {} });
    });
  });
});
