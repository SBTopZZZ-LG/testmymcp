/**
 * Sentinel persisted in place of a scannable env secret's real value. Keeps the
 * key name (so `test <id>` knows what to ask for) without ever storing the
 * value in plaintext.
 */
export declare const SECRET_ENV_SENTINEL = "__TESTMYMCP_SECRET__";
export interface SanitizedEnv {
    env: Record<string, string>;
    requiresSecretEnv: boolean;
}
export declare function isEnvSecret(key: string): boolean;
export declare function parseEnvEntries(values: readonly string[] | undefined): Record<string, string>;
export declare function sanitizeEnvForStore(env: Record<string, string> | undefined): SanitizedEnv;
export declare function expandStoredEnv(stored: Record<string, string> | undefined, provided: Record<string, string> | undefined): Record<string, string>;
