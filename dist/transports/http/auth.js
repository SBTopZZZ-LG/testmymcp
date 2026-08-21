import { request } from 'undici';
const DISCOVERY_PATHS = [
    '/.well-known/oauth-authorization-server',
    '/.well-known/openid-configuration',
];
function isOAuthMetadata(value) {
    return typeof value === 'object' && value !== null;
}
/**
 * Probe the server for OAuth discovery metadata. Returns immediately with
 * `no-oauth-metadata` (no network) when a `bearer` token is already configured.
 */
export async function discoverProtectedEndpoint(baseUrl, auth, timeoutMs = 4000) {
    if (auth !== undefined && auth.mode === 'bearer') {
        return { kind: 'no-oauth-metadata', note: 'bearer token supplied; no discovery needed' };
    }
    const origin = safeOrigin(baseUrl);
    if (origin === null) {
        return { kind: 'probe-failed', note: `cannot derive origin from "${baseUrl}"` };
    }
    for (const path of DISCOVERY_PATHS) {
        try {
            const response = await request(origin + path, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                headersTimeout: timeoutMs,
                bodyTimeout: timeoutMs,
            });
            const status = response.statusCode;
            if (status >= 200 && status < 300) {
                let payload;
                try {
                    payload = await response.body.json();
                }
                catch {
                    payload = undefined;
                }
                if (isOAuthMetadata(payload) && typeof payload.issuer === 'string') {
                    return {
                        kind: 'oauth-protected',
                        issuer: payload.issuer,
                        authorizationEndpoint: typeof payload.authorization_endpoint === 'string'
                            ? payload.authorization_endpoint
                            : undefined,
                        tokenEndpoint: typeof payload.token_endpoint === 'string' ? payload.token_endpoint : undefined,
                        note: `OAuth resource metadata discovered at ${origin + path}`,
                    };
                }
            }
            // 404/401 on this path -> keep probing the next one.
        }
        catch (error) {
            // Network error while probing a discovery path: not authoritative.
            return {
                kind: 'probe-failed',
                note: `discovery probe failed: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
    return { kind: 'no-oauth-metadata', note: 'no OAuth discovery metadata advertised' };
}
export function describeAuth(auth) {
    if (auth === undefined || auth.mode === 'none')
        return 'none';
    return `bearer (token ${'*'.repeat(Math.min(6, auth.token?.length ?? 0))})`;
}
function safeOrigin(url) {
    try {
        const parsed = new URL(url);
        return parsed.origin;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=auth.js.map