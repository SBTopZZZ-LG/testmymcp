import { isSensitiveKey } from '../core/tracing/redaction.js';
/**
 * Sentinel persisted in place of a scannable env secret's real value. Keeps the
 * key name (so `test <id>` knows what to ask for) without ever storing the
 * value in plaintext.
 */
export const SECRET_ENV_SENTINEL = '__TESTMYMCP_SECRET__';
export function isEnvSecret(key) {
    return isSensitiveKey(key);
}
export function parseEnvEntries(values) {
    const env = {};
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
export function sanitizeEnvForStore(env) {
    if (env === undefined || Object.keys(env).length === 0) {
        return { env: {}, requiresSecretEnv: false };
    }
    const stored = {};
    let requiresSecretEnv = false;
    for (const [key, value] of Object.entries(env)) {
        if (isEnvSecret(key)) {
            stored[key] = SECRET_ENV_SENTINEL;
            requiresSecretEnv = true;
        }
        else {
            stored[key] = value;
        }
    }
    return { env: stored, requiresSecretEnv };
}
export function expandStoredEnv(stored, provided) {
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
        throw new Error(`session requires secret env value(s) for: ${missing.map((key) => `--env ${key}=...`).join(', ')}`);
    }
    return env;
}
//# sourceMappingURL=env.js.map