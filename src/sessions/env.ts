import { isSensitiveKey } from '../core/tracing/redaction.js';

/**
 * Sentinel persisted in place of a scannable env secret's real value. Keeps the
 * key name (so `test <id>` knows what to ask for) without ever storing the
 * value in plaintext.
 */
export const SECRET_ENV_SENTINEL = '__TESTMYMCP_SECRET__';

export interface SanitizedEnv {
  env: Record<string, string>;
  requiresSecretEnv: boolean;
}

export function isEnvSecret(key: string): boolean {
  return isSensitiveKey(key);
}

export function parseEnvEntries(values: readonly string[] | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of values ?? []) {
    const equals = entry.indexOf('=');
    if (equals <= 0) {
      throw new Error(`invalid --env entry "${entry}" (expected KEY=VALUE)`);
    }
    const key = entry.slice(0, equals);
    const value = entry.slice(equals + 1);
    env[key] = value;
  }
  return env;
}

export function sanitizeEnvForStore(env: Record<string, string> | undefined): SanitizedEnv {
  if (env === undefined || Object.keys(env).length === 0) {
    return { env: {}, requiresSecretEnv: false };
  }
  const stored: Record<string, string> = {};
  let requiresSecretEnv = false;
  for (const [key, value] of Object.entries(env)) {
    if (isEnvSecret(key)) {
      stored[key] = SECRET_ENV_SENTINEL;
      requiresSecretEnv = true;
    } else {
      stored[key] = value;
    }
  }
  return { env: stored, requiresSecretEnv };
}

export function expandStoredEnv(
  stored: Record<string, string> | undefined,
  provided: Record<string, string> | undefined,
): Record<string, string> {
  if (stored === undefined || Object.keys(stored).length === 0) {
    return { ...(provided ?? {}) };
  }
  const env = { ...stored };
  for (const [key, value] of Object.entries(provided ?? {})) {
    if (env[key] === undefined || env[key] === SECRET_ENV_SENTINEL || !isEnvSecret(key)) {
      env[key] = value;
    }
  }
  const missing = Object.keys(env).filter((key) => env[key] === SECRET_ENV_SENTINEL);
  if (missing.length > 0) {
    throw new Error(
      `session requires secret env value(s) for: ${missing.map((key) => `--env ${key}=...`).join(', ')}`,
    );
  }
  return env;
}
