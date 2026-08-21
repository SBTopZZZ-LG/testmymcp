import { expandStoredEnv, sanitizeEnvForStore } from './env.js';
export function sanitizeToStoredTarget(target) {
    if (target.transport === 'stdio') {
        const { env, requiresSecretEnv } = sanitizeEnvForStore(target.env);
        return {
            target: {
                transport: 'stdio',
                command: target.command,
                era: target.era,
                version: target.version,
                maxLineBytes: target.maxLineBytes,
                env,
            },
            requiresToken: false,
            requiresSecretEnv,
        };
    }
    const requiresToken = target.auth?.mode === 'bearer' && target.auth.token !== undefined;
    return {
        target: {
            transport: 'http',
            url: target.url,
            httpTransport: target.httpTransport,
            authMode: target.auth?.mode === 'bearer' ? 'bearer' : 'none',
            era: target.era,
            version: target.version,
            accept: target.accept,
        },
        requiresToken,
        requiresSecretEnv: false,
    };
}
export function expandStoredTarget(stored, token, secretEnv) {
    if (stored.transport === 'stdio') {
        return {
            transport: 'stdio',
            command: stored.command,
            era: stored.era,
            version: stored.version,
            maxLineBytes: stored.maxLineBytes,
            env: expandStoredEnv(stored.env, secretEnv),
        };
    }
    return {
        transport: 'http',
        url: stored.url,
        httpTransport: stored.httpTransport,
        auth: stored.authMode === 'bearer' ? { mode: 'bearer', token } : { mode: 'none' },
        era: stored.era,
        version: stored.version,
        accept: stored.accept,
    };
}
//# sourceMappingURL=types.js.map