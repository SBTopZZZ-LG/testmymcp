export const REDACTED = 'REDACTED';

const SENSITIVE_EXACT_KEYS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'api_key',
  'apikey',
  'access-token',
  'access_token',
  'refresh-token',
  'refresh_token',
  'id-token',
  'id_token',
  'client-secret',
  'client_secret',
  'secret_key',
  'session-id',
  'session_id',
  'sessionid',
  'private-key',
  'private_key',
  'oauth-token',
  'oauth_token',
  'oidc-token',
  'oidc_token',
  'app-secret',
  'app_secret',
  'jwt',
]);

const SENSITIVE_LAST_TOKENS = new Set([
  'token',
  'secret',
  'password',
  'passwd',
  'pwd',
  'credential',
  'credentials',
  'apikey',
  'api_key',
  'access_token',
  'refresh_token',
  'client_secret',
  'private_key',
  'key',
]);

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower.includes('progress')) return false;
  const last = lower
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .at(-1);
  return SENSITIVE_EXACT_KEYS.has(lower) || (last !== undefined && SENSITIVE_LAST_TOKENS.has(last));
}

const VALUE_REDACTORS: readonly { pattern: RegExp; replacement: string }[] = [
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement: 'Bearer REDACTED' },
  { pattern: /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, replacement: REDACTED },
  {
    pattern: /("[^"]*(?:token|secret|password|passwd|api[_-]?key)[^"]*"\s*:\s*")([^"]*)(")/gi,
    replacement: '$1REDACTED$3',
  },
];

export function redactString(input: string): string {
  let output = input;
  for (const redactor of VALUE_REDACTORS) {
    output = output.replace(redactor.pattern, redactor.replacement);
  }
  return output;
}

export function redactDeep(value: unknown, seen?: WeakSet<object>): unknown {
  const visited = seen ?? new WeakSet<object>();
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) {
    if (visited.has(value)) return REDACTED;
    visited.add(value);
    return value.map((item) => redactDeep(item, visited));
  }
  if (typeof value === 'object' && value !== null) {
    if (visited.has(value)) return REDACTED;
    visited.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = isSensitiveKey(key) ? REDACTED : redactDeep(item, visited);
    }
    return output;
  }
  return value;
}