import { describe, expect, it } from 'vitest';

import {
  buildMcpParamHeaders,
  collectXMcpHeaders,
  sanitizeToolHeaders,
  validateToolHeaders,
} from '../../src/transports/http/x-mcp-header.js';

describe('collectXMcpHeaders', () => {
  it('collects top-level annotations with full paths', () => {
    const schema = {
      type: 'object',
      properties: {
        region: { type: 'string', 'x-mcp-header': 'Region' },
        count: { type: 'integer' },
      },
    };
    const found = collectXMcpHeaders(schema);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ path: ['region'], type: 'string', headerName: 'Region' });
  });

  it('collects nested annotations with compound paths', () => {
    const schema = {
      type: 'object',
      properties: {
        auth: {
          type: 'object',
          properties: {
            token: { type: 'string', 'x-mcp-header': 'Authorization' },
          },
        },
      },
    };
    const found = collectXMcpHeaders(schema);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ path: ['auth', 'token'], headerName: 'Authorization' });
  });

  it('returns empty for non-object schemas', () => {
    expect(collectXMcpHeaders('nope')).toEqual([]);
    expect(collectXMcpHeaders(undefined)).toEqual([]);
  });
});

describe('validateToolHeaders', () => {
  it('accepts a conforming schema', () => {
    const schema = {
      type: 'object',
      properties: {
        region: { type: 'string', 'x-mcp-header': 'Region' },
        count: { type: 'integer', 'x-mcp-header': 'Request-Count' },
        ok: { type: 'boolean', 'x-mcp-header': 'X-Ok' },
      },
    };
    expect(validateToolHeaders(schema).valid).toBe(true);
  });

  it('rejects duplicated header names (case-insensitive)', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'string', 'x-mcp-header': 'Region' },
        b: { type: 'string', 'x-mcp-header': 'region' },
      },
    };
    const result = validateToolHeaders(schema);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('duplicate');
  });

  it('rejects non-primitive (number/object) annotated types', () => {
    const schema = {
      type: 'object',
      properties: {
        n: { type: 'number', 'x-mcp-header': 'Num' },
      },
    };
    expect(validateToolHeaders(schema).valid).toBe(false);
  });

  it('rejects invalid field-name tokens and control chars', () => {
    const badToken = {
      type: 'object',
      properties: { a: { type: 'string', 'x-mcp-header': 'Bad Header' } },
    };
    const badCrlf = {
      type: 'object',
      properties: { a: { type: 'string', 'x-mcp-header': 'X\r\nInjected' } },
    };
    expect(validateToolHeaders(badToken).valid).toBe(false);
    expect(validateToolHeaders(badCrlf).valid).toBe(false);
  });
});

describe('buildMcpParamHeaders', () => {
  const schema = {
    type: 'object',
    properties: {
      region: { type: 'string', 'x-mcp-header': 'Region' },
      count: { type: 'integer', 'x-mcp-header': 'Count' },
      ok: { type: 'boolean', 'x-mcp-header': 'OK' },
      secret: {
        type: 'object',
        properties: { token: { type: 'string', 'x-mcp-header': 'X-Token' } },
      },
    },
  };

  it('mirrors top-level annotated args into Mcp-Param headers', () => {
    const out = buildMcpParamHeaders(schema, { region: 'us-east-1', count: 3, ok: true });
    expect(out).toEqual({
      'Mcp-Param-Region': 'us-east-1',
      'Mcp-Param-Count': '3',
      'Mcp-Param-OK': 'true',
    });
  });

  it('omits absent/null parameters', () => {
    const out = buildMcpParamHeaders(schema, { region: null });
    expect(out['Mcp-Param-Region']).toBeUndefined();
  });

  it('reads nested annotated values by path', () => {
    const out = buildMcpParamHeaders(schema, { secret: { token: 'abc' } });
    expect(out['Mcp-Param-X-Token']).toBe('abc');
  });

  it('base64-encodes unsafe values', () => {
    const out = buildMcpParamHeaders(schema, { region: '=?base64?evil' });
    const expected = `=?base64?${Buffer.from('=?base64?evil', 'utf8').toString('base64')}?=`;
    expect(out['Mcp-Param-Region']).toBe(expected);
  });

  it('returns empty when the schema is invalid', () => {
    const bad = {
      type: 'object',
      properties: {
        a: { type: 'string', 'x-mcp-header': 'Dup' },
        b: { type: 'string', 'x-mcp-header': 'dup' },
      },
    };
    expect(buildMcpParamHeaders(bad, { a: 'x', b: 'y' })).toEqual({});
  });
});

describe('sanitizeToolHeaders', () => {
  it('keeps a conforming tool', () => {
    const tool = {
      name: 't',
      inputSchema: { type: 'object', properties: { a: { type: 'string', 'x-mcp-header': 'A' } } },
    };
    expect(sanitizeToolHeaders(tool)).toMatchObject({ valid: true, tool });
  });

  it('rejects a non-conforming tool and reports a reason', () => {
    const tool = {
      name: 't',
      inputSchema: { type: 'object', properties: { a: { type: 'string', 'x-mcp-header': '' } } },
    };
    const result = sanitizeToolHeaders(tool);
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});
