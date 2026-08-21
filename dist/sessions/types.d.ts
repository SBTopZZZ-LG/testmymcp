import type { ProtocolEra, ProtocolVersion } from '../core/types/protocol.js';
import type { StreamableHttpAccept } from '../transports/http/streamable-http-transport.js';
import type { AuthConfig } from '../transports/http/types.js';
export type HttpTransportKind = 'streamable-http' | 'legacy-sse';
/**
 * A connection target, exactly what is needed to build a transport + adapter
 * for one engine run. Tokens are intentional here: they are present for the
 * duration of a run and never persisted.
 */
export type SessionTarget = {
    transport: 'stdio';
    command: string;
    era?: ProtocolEra;
    version?: ProtocolVersion;
    maxLineBytes?: number;
    /** Env vars merged over the current process environment for the child. */
    env?: Record<string, string>;
} | {
    transport: 'http';
    url: string;
    httpTransport: HttpTransportKind;
    auth?: AuthConfig;
    era?: ProtocolEra;
    version?: ProtocolVersion;
    accept?: StreamableHttpAccept;
};
/**
 * The serialized, on-disk form of a target. The bearer token (if any) is never
 * written; only its mode is kept, alongside a `requiresToken` flag so a later
 * `test <id>` knows to ask for the token again. Env vars are kept but secret
 * values are replaced by a sentinel (see `SECRET_ENV_SENTINEL`).
 */
export type StoredTarget = {
    transport: 'stdio';
    command: string;
    era?: ProtocolEra;
    version?: ProtocolVersion;
    maxLineBytes?: number;
    env?: Record<string, string>;
} | {
    transport: 'http';
    url: string;
    httpTransport: HttpTransportKind;
    authMode: 'none' | 'bearer';
    era?: ProtocolEra;
    version?: ProtocolVersion;
    accept?: StreamableHttpAccept;
};
export interface StoredSession {
    id: string;
    name?: string;
    createdAt: number;
    lastUsedAt: number;
    target: StoredTarget;
    requiresToken: boolean;
    requiresSecretEnv: boolean;
    serverName?: string;
    serverVersion?: string;
    protocolVersion?: string;
    note?: string;
}
export declare function sanitizeToStoredTarget(target: SessionTarget): {
    target: StoredTarget;
    requiresToken: boolean;
    requiresSecretEnv: boolean;
};
export declare function expandStoredTarget(stored: StoredTarget, token?: string, secretEnv?: Record<string, string>): SessionTarget;
