import { describe, expect, it } from 'vitest';

import {
  SECRET_ENV_SENTINEL,
  expandStoredEnv,
  isEnvSecret,
  parseEnvEntries,
  sanitizeEnvForStore,
} from '../../src/sessions/env.js';

describe('parseEnvEntries', () => {
  it('parses repeatable KEY=VALUE pairs', () => {
    expect(parseEnvEntries(['A=1', 'B=two'])).toEqual({ A: '1', B: 'two' });
    expect(parseEnvEntries(undefined)).toEqual({});
    expect(parseEnvEntries(['EMPTY='])).toEqual({ EMPTY: '' });
  });

  it('rejects entries without an equals sign', () => {
    expect(() => parseEnvEntries(['JUSTKEY'])).toThrow(/expected KEY=VALUE/);
  });
});

describe('isEnvSecret', () => {
  it('classifies keyword-bearing keys as secret', () => {
    expect(isEnvSecret('PLANE_API_KEY')).toBe(true);
    expect(isEnvSecret('GITHUB_TOKEN')).toBe(true);
    expect(isEnvSecret('CLIENT_SECRET')).toBe(true);
  });

  it('keeps benign keys', () => {
    expect(isEnvSecret('PLANE_BASE_URL')).toBe(false);
    expect(isEnvSecret('WORKSPACE_SLUG')).toBe(false);
    expect(isEnvSecret('PORT')).toBe(false);
  });
});

describe('sanitizeEnvForStore', () => {
  it('redacts secret values with a sentinel and flags them', () => {
    const { env, requiresSecretEnv } = sanitizeEnvForStore({
      PLANE_API_KEY: 'super-secret',
      PLANE_BASE_URL: 'http://localhost:30100',
    });
    expect(requiresSecretEnv).toBe(true);
    expect(env.PLANE_API_KEY).toBe(SECRET_ENV_SENTINEL);
    expect(env.PLANE_BASE_URL).toBe('http://localhost:30100');
    expect(JSON.stringify(env)).not.toContain('super-secret');
  });

  it('returns empty/no-flag for absent or empty env', () => {
    expect(sanitizeEnvForStore(undefined)).toEqual({ env: {}, requiresSecretEnv: false });
    expect(sanitizeEnvForStore({})).toEqual({ env: {}, requiresSecretEnv: false });
  });
});

describe('expandStoredEnv', () => {
  it('fills sentinels from provided values and drops them from the result', () => {
    const stored = sanitizeEnvForStore({
      PLANE_API_KEY: 'ignored',
      PLANE_BASE_URL: 'http://localhost:30100',
    }).env;
    const expanded = expandStoredEnv(stored, { PLANE_API_KEY: 'real-value' });
    expect(expanded.PLANE_API_KEY).toBe('real-value');
    expect(expanded.PLANE_BASE_URL).toBe('http://localhost:30100');
    expect(Object.values(expanded)).not.toContain(SECRET_ENV_SENTINEL);
  });

  it('throws when a secret is required but not supplied', () => {
    const stored = sanitizeEnvForStore({ PLANE_API_KEY: 'x' }).env;
    expect(() => expandStoredEnv(stored, undefined)).toThrow(/PLANE_API_KEY/);
  });

  it('merges provided non-secret overrides and keeps extra provided keys', () => {
    const expanded = expandStoredEnv({ PORT: '8080' }, { PORT: '9000', EXTRA: 'y' });
    expect(expanded).toEqual({ PORT: '9000', EXTRA: 'y' });
  });

  it('handles empty stored env', () => {
    expect(expandStoredEnv(undefined, { A: '1' })).toEqual({ A: '1' });
    expect(expandStoredEnv(undefined, undefined)).toEqual({});
  });
});
