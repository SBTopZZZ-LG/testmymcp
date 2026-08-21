import type { ProtocolEra, ProtocolVersion } from '../core/types/protocol.js';
import type { AuthConfig } from '../transports/http/types.js';
import type { StreamableHttpAccept } from '../transports/http/streamable-http-transport.js';
import { sanitizeEnvForStore, expandStoredEnv } from './env.js';

export type HttpTransportKind = 'streamable-http' | 'legacy-sse';

/**
 * A connection target, exactly what is needed to build a transport + adapter
 * for one engine run. Tokens are intentional here: they are present for the
 * duration of a run and never persisted.
 */
export type SessionTarget =
  | {
      transport: 'stdio';
      command: string;
      era?: ProtocolEra;
      version?: ProtocolVersion;
      maxLineBytes?: number;
      /** Env vars merged over the current process environment for the child. */
      env?: Record<string, string>;
    }
  | {
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
export type StoredTarget =
  | {
      transport: 'stdio';
      command: string;
      era?: ProtocolEra;
      version?: ProtocolVersion;
      maxLineBytes?: number;
      env?: Record<string, string>;
    }
  | {
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

export function sanitizeToStoredTarget(target: SessionTarget): {
  target: StoredTarget;
  requiresToken: boolean;
  requiresSecretEnv: boolean;
} {
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

export function expandStoredTarget(
  stored: StoredTarget,
  token?: string,
  secretEnv?: Record<string, string>,
): SessionTarget {
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

