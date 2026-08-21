import { describe, expect, it } from 'vitest';

import { emptyClientCapabilities } from '../../src/core/protocol/capabilities.js';
import {
  buildInitializeParams,
  parseInitializeResult,
} from '../../src/protocols/legacy/initialize.js';

describe('legacy initialize', () => {
  it('builds negotiated params with client capabilities', () => {
    const params = buildInitializeParams({
      protocolVersion: '2025-11-25',
      clientInfo: { name: 't', version: '1' },
      clientCapabilities: {
        ...emptyClientCapabilities(),
        roots: true,
        sampling: false,
        elicitation: false,
      },
    }) as Record<string, unknown>;
    expect(params.protocolVersion).toBe('2025-11-25');
    expect(params.clientInfo).toEqual({ name: 't', version: '1' });
    expect(params.capabilities).toEqual({ roots: {} });
  });

  it('does not advertise empty capabilities when none requested', () => {
    const params = buildInitializeParams({
      protocolVersion: '2025-11-25',
      clientInfo: {},
      clientCapabilities: emptyClientCapabilities(),
    }) as Record<string, unknown>;
    expect(params.capabilities).toEqual({});
  });

  it('parses a well-formed result', () => {
    const result = parseInitializeResult({
      protocolVersion: '2025-11-25',
      serverInfo: { name: 's', version: '2' },
      capabilities: { tools: {}, resources: {} },
    });
    expect(result.protocolVersion).toBe('2025-11-25');
    expect(result.serverInfo.name).toBe('s');
    expect(result.serverInfo.version).toBe('2');
    expect(result.serverCapabilities.tools).toBe(true);
    expect(result.serverCapabilities.resources).toBe(true);
    expect(result.serverCapabilities.prompts).toBe(false);
  });

  it('rejects unknown versions and non-object results', () => {
    expect(() => parseInitializeResult({ protocolVersion: '2100-01-01' })).toThrow(
      'unknown protocol version',
    );
    expect(() => parseInitializeResult(null)).toThrow('not an object');
    expect(() => parseInitializeResult({})).toThrow('missing protocolVersion');
  });
});
