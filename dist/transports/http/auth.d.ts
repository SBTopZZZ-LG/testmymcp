import type { AuthConfig } from './types.js';
/**
 * Minimal auth handling for MCP HTTP transports.
 *
 * Phase 2 supports two modes:
 *  - `none`: no credentials.
 *  - `bearer`: sends `Authorization: Bearer <token>`.
 *
 * OAuth flow itself is deferred; `discoverProtectedEndpoint` performs a
 * best-effort OAuth Resource-Server discovery probe so a CLI run can surface a
 * warning when the endpoint advertises OAuth protection and no token was
 * supplied (rather than silently failing).
 */
export type AuthDiscoveryKind = 'oauth-protected' | 'no-oauth-metadata' | 'probe-failed';
export interface OAuthDiscoveryResult {
    readonly kind: AuthDiscoveryKind;
    readonly issuer?: string;
    readonly authorizationEndpoint?: string;
    readonly tokenEndpoint?: string;
    readonly note?: string;
}
/**
 * Probe the server for OAuth discovery metadata. Returns immediately with
 * `no-oauth-metadata` (no network) when a `bearer` token is already configured.
 */
export declare function discoverProtectedEndpoint(baseUrl: string, auth?: AuthConfig, timeoutMs?: number): Promise<OAuthDiscoveryResult>;
export declare function describeAuth(auth: AuthConfig | undefined): string;
