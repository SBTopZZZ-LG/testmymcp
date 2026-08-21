import { describe, expect, it } from 'vitest';
import { REDACTED, isSensitiveKey, redactDeep, redactString } from '../../src/core/tracing/redaction.js';

describe('redaction', () => {
  it('recognizes common secret key names regardless of case or casing style', () => {
    for (const key of ['Authorization', 'authorization', 'X-API-Key', 'api_key', 'access_token', 'client_secret', 'Set-Cookie', 'password']) {
      expect(isSensitiveKey(key)).toBe(true);
    }
  });

  it('does not treat protocol metadata as a secret', () => {
    expect(isSensitiveKey('progressToken')).toBe(false);
    expect(isSensitiveKey('inputSchema')).toBe(false);
    expect(isSensitiveKey('description')).toBe(false);
  });

  it('redacts sensitive keys in nested payloads', () => {
    const payload = {
      headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' },
      params: { text: 'hello', password: 'hunter2' },
    };
    const redacted = redactDeep(payload) as Record<string, unknown>;
    expect(redacted.headers).toMatchObject({ Authorization: REDACTED, 'Content-Type': 'application/json' });
    expect(redacted.params).toMatchObject({ text: 'hello', password: REDACTED });
  });

  it('preserves progress tokens and non-sensitive arguments', () => {
    const payload = { progressToken: 42, input: { a: 1 }, headers: { foo: 'bar' } };
    expect(redactDeep(payload)).toEqual({ progressToken: 42, input: { a: 1 }, headers: { foo: 'bar' } });
  });

  it('masks bearer tokens and JWTs in strings', () => {
    expect(redactString('Bearer abc123.def')).toContain('Bearer REDACTED');
    expect(redactString('Authorization: Bearer abc123')).not.toContain('abc123');
    expect(redactString('jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.payload')).toBe('jwt=REDACTED');
  });

  it('redacts inline secret assignments in JSON text', () => {
    const text = '{"access_token": "supersecret", "msg": "hi"}';
    const result = redactString(text);
    expect(result).not.toContain('supersecret');
    expect(result).toContain(REDACTED);
  });

  it('handles arrays and cyclic structures without infinite recursion', () => {
    const cyclic: Record<string, unknown> = { name: 'node' };
    cyclic.self = cyclic;
    const redacted = redactDeep(cyclic) as Record<string, unknown>;
    expect(redacted.self).toBe(REDACTED);

    expect(redactDeep([{ password: 'x' }, 'plain'])).toEqual([{ password: REDACTED }, 'plain']);
  });
});