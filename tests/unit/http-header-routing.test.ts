import { describe, expect, it } from 'vitest';
import {
  buildRequestHeaders,
  isLegacyProtocolVersion,
  readJsonResponseHeaders,
  validateJsonResponseHeaders,
} from '../../src/transports/http/header-routing.js';

const headers = (overrides: Record<string, string | undefined>): unknown => ({
  'content-type': 'application/json',
  'mcp-protocol-version': '2025-11-25',
  'mcp-method': 'initialize',
  'mcp-name': 'fakeserver',
  'mcp-session-id': 'sess_abc',
  ...overrides,
});

function normalize(h: unknown, name: string): string | undefined {
  const record = h as Record<string, string | undefined>;
  return record[name];
}

describe('HTTP header routing validation', () => {
  it('passes a conforming response', () => {
    const view = readJsonResponseHeaders(headers({}), normalize);
    const result = validateJsonResponseHeaders(view, 'initialize');
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('flags a mismatched Mcp-Method as an error', () => {
    const view = readJsonResponseHeaders(headers({ 'mcp-method': 'initialize-WRONG' }), normalize);
    const result = validateJsonResponseHeaders(view, 'initialize');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.header === 'Mcp-Method' && i.severity === 'error')).toBe(true);
    expect(result.issues.find((i) => i.header === 'Mcp-Method')?.actual).toBe('initialize-WRONG');
  });

  it('flags a missing Mcp-Method as an error', () => {
    const view = readJsonResponseHeaders(headers({ 'mcp-method': undefined }), normalize);
    const result = validateJsonResponseHeaders(view, 'tools/list');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.header === 'Mcp-Method' && i.severity === 'error')).toBe(true);
  });

  it('warns on a missing MCP-Protocol-Version', () => {
    const view = readJsonResponseHeaders(headers({ 'mcp-protocol-version': undefined }), normalize);
    const result = validateJsonResponseHeaders(view, 'initialize');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.header === 'MCP-Protocol-Version' && i.severity === 'warn')).toBe(true);
  });

  it('warns on an unknown (non-legacy) protocol version', () => {
    const view = readJsonResponseHeaders(headers({ 'mcp-protocol-version': '2099-01-01' }), normalize);
    const result = validateJsonResponseHeaders(view, 'initialize');
    expect(result.issues.some((i) => i.header === 'MCP-Protocol-Version' && i.severity === 'warn')).toBe(true);
  });

  it('does not demand Mcp-Method when no method is supplied (e.g. notifications)', () => {
    const view = readJsonResponseHeaders(headers({ 'mcp-method': undefined }), normalize);
    const result = validateJsonResponseHeaders(view, undefined);
    expect(result.issues.some((i) => i.header === 'Mcp-Method')).toBe(false);
  });

  it('builds request headers with the standard content/accept and optional version', () => {
    const h = buildRequestHeaders({ protocolVersion: '2025-11-25' });
    expect(h['Content-Type']).toBe('application/json');
    expect(h['Accept']).toBe('application/json, text/event-stream');
    expect(h['MCP-Protocol-Version']).toBe('2025-11-25');
  });

  it('accepts the modern protocol version when modern is set', () => {
    const view = readJsonResponseHeaders(headers({ 'mcp-protocol-version': '2026-07-28' }), normalize);
    const result = validateJsonResponseHeaders(view, 'tools/list', { modern: true });
    const versionIssue = result.issues.find((i) => i.header === 'MCP-Protocol-Version');
    expect(versionIssue).toBeUndefined();
  });

  it('rejects the modern version when modern is not set (legacy validation)', () => {
    const view = readJsonResponseHeaders(headers({ 'mcp-protocol-version': '2026-07-28' }), normalize);
    const result = validateJsonResponseHeaders(view, 'tools/list');
    expect(result.issues.some((i) => i.header === 'MCP-Protocol-Version' && i.severity === 'warn')).toBe(true);
  });
});

describe('isLegacyProtocolVersion', () => {
  it('accepts known legacy versions and rejects modern', () => {
    expect(isLegacyProtocolVersion('2025-11-25')).toBe(true);
    expect(isLegacyProtocolVersion('2026-07-28')).toBe(false);
    expect(isLegacyProtocolVersion('garbage')).toBe(false);
  });
});
