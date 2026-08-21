import { describe, expect, it } from 'vitest';
import {
  parseServerCapabilities,
  toClientCapabilitiesJson,
  emptyClientCapabilities,
} from '../../src/core/protocol/capabilities.js';

describe('parseServerCapabilities (modern extensions)', () => {
  it('parses extensions and per-feature flags', () => {
    const caps = parseServerCapabilities(
      {
        tools: { listChanged: true },
        resources: { subscribe: true },
        prompts: { listChanged: true },
        extensions: { 'io.modelcontextprotocol/tasks': {} },
      },
      '2026-07-28',
    );
    expect(caps.tools).toBe(true);
    expect(caps.toolListChanged).toBe(true);
    expect(caps.resourceSubscribe).toBe(true);
    expect(caps.promptListChanged).toBe(true);
    expect(caps.extensions?.['io.modelcontextprotocol/tasks']).toEqual({});
  });

  it('leaves feature flags false when only the base capability is present', () => {
    const caps = parseServerCapabilities({ tools: {} }, '2026-07-28');
    expect(caps.tools).toBe(true);
    expect(caps.toolListChanged).toBe(false);
  });
});

describe('toClientCapabilitiesJson', () => {
  it('serializes structured elicitation and sampling with extensions', () => {
    const caps = {
      ...emptyClientCapabilities(),
      elicitation: true,
      elicitationForm: true,
      elicitationUrl: true,
      sampling: true,
      samplingTools: true,
      extensions: { 'io.modelcontextprotocol/tasks': {} },
    };
    const json = toClientCapabilitiesJson(caps);
    expect(json.elicitation).toEqual({ form: {}, url: {} });
    expect(json.sampling).toEqual({ tools: {} });
    expect(json.extensions).toEqual({ 'io.modelcontextprotocol/tasks': {} });
  });
});
