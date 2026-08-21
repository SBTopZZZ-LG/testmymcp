import { describe, expect, it } from 'vitest';
import { describeAuth, discoverProtectedEndpoint } from '../../src/transports/http/auth.js';

describe('HTTP auth', () => {
  it('describes none and bearer modes', () => {
    expect(describeAuth(undefined)).toBe('none');
    expect(describeAuth({ mode: 'none' })).toBe('none');
    expect(describeAuth({ mode: 'bearer', token: 'abc123' })).toContain('bearer');
    expect(describeAuth({ mode: 'bearer', token: 'abc123' })).not.toContain('abc123');
  });

  it('skips discovery when a bearer token is already configured', async () => {
    const result = await discoverProtectedEndpoint('http://127.0.0.1:1/', { mode: 'bearer', token: 'x' });
    expect(result.kind).toBe('no-oauth-metadata');
  });

  it('returns probe-failed for an unusable base url', async () => {
    const result = await discoverProtectedEndpoint('not a url', undefined, 100);
    expect(result.kind).toBe('probe-failed');
  });
});
