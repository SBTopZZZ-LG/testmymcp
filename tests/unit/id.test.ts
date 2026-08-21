import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../../src/core/jsonrpc/id.js';

describe('request id generator', () => {
  it('emits sequential numeric ids', () => {
    const next = createIdGenerator('number');
    expect([next(), next(), next()]).toEqual([1, 2, 3]);
  });

  it('emits string ids', () => {
    const next = createIdGenerator('string');
    expect(next()).toBe('req-1');
    expect(next()).toBe('req-2');
  });

  it('emits a mixed sequence that exercises both number and string ids', () => {
    const next = createIdGenerator('mixed');
    expect([next(), next(), next(), next(), next(), next()]).toEqual([
      1,
      2,
      3,
      'abc',
      'tool-call-1',
      'tool-call-2',
    ]);
  });

  it('emits large and odd ids', () => {
    const next = createIdGenerator('large');
    const ids = [next(), next(), next(), next()];
    expect(ids).toContain(9007199254740991);
    expect(ids[0]).toBe('131621703842267136');
    expect(ids[1]).toBe(9007199254740991);
  });

  it('keeps produced ids unique', () => {
    const next = createIdGenerator('mixed');
    const seen = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      const id = next();
      const key = `${typeof id}:${String(id)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
