import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore, SessionStoreError, deriveSessionId } from '../../src/sessions/store.js';
import type { SessionTarget, StoredSession } from '../../src/sessions/types.js';
import { expandStoredTarget, sanitizeToStoredTarget } from '../../src/sessions/types.js';

async function tempFile(): Promise<{ file: string; store: SessionStore; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'tmcp-store-'));
  const file = join(dir, 'sessions.json');
  return {
    file,
    store: new SessionStore(file),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

const stdioTarget: SessionTarget = { transport: 'stdio', command: 'node fake.js' };

describe('SessionStore', () => {
  it('derives a stable id from a target, insensitive to the token value', () => {
    const first = deriveSessionId(stdioTarget);
    expect(first).toMatch(/^stdio-/);
    expect(deriveSessionId(stdioTarget)).toBe(first);

    const bearerA: SessionTarget = {
      transport: 'http',
      url: 'https://example.com/mcp',
      httpTransport: 'streamable-http',
      auth: { mode: 'bearer', token: 'sekrit-a' },
    };
    const bearerB: SessionTarget = {
      transport: 'http',
      url: 'https://example.com/mcp',
      httpTransport: 'streamable-http',
      auth: { mode: 'bearer', token: 'sekrit-b' },
    };
    const anonymous: SessionTarget = {
      transport: 'http',
      url: 'https://example.com/mcp',
      httpTransport: 'streamable-http',
      auth: { mode: 'none' },
    };
    expect(deriveSessionId(bearerA)).toBe(deriveSessionId(bearerB));
    expect(deriveSessionId(bearerA)).not.toBe(deriveSessionId(anonymous));
    expect(first).not.toBe(deriveSessionId(anonymous));
    expect(deriveSessionId(anonymous)).toMatch(/^http-/);
  });

  it('sanitizes targets for storage and flags when a token is required', () => {
    const http: SessionTarget = {
      transport: 'http',
      url: 'https://example.com/mcp',
      httpTransport: 'legacy-sse',
      auth: { mode: 'bearer', token: 'sekrit-token' },
      era: 'legacy',
      version: '2025-11-25',
      accept: 'sse',
    };
    const { target, requiresToken } = sanitizeToStoredTarget(http);
    expect(requiresToken).toBe(true);
    expect(target).toMatchObject({ transport: 'http', url: http.url, httpTransport: 'legacy-sse', authMode: 'bearer' });
    expect(JSON.stringify(target)).not.toContain('sekrit-token');

    const expanded = expandStoredTarget(target, 'new-token');
    expect(expanded).toMatchObject({ transport: 'http', url: http.url, httpTransport: 'legacy-sse', accept: 'sse' });
    if (expanded.transport === 'http') {
      expect(expanded.auth?.token).toBe('new-token');
    }
  });

  it('persists and reloads a session across store instances', async () => {
    const { file, store, cleanup } = await tempFile();
    try {
      const record: StoredSession = {
        id: 'stdio-abc',
        name: 'demo',
        createdAt: 1,
        lastUsedAt: 1,
        target: { transport: 'stdio', command: 'node fake.js' },
        requiresToken: false,
        serverName: 'fake',
      };
      await store.create(record);

      const reopened = new SessionStore(file);
      const list = await reopened.list(false);
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe('stdio-abc');
      expect(await reopened.get('demo')).toMatchObject({ id: 'stdio-abc' });
      expect(await reopened.get('stdio-abc')).toMatchObject({ id: 'stdio-abc' });
    } finally {
      await cleanup();
    }
  });

  it('never writes a bearer token to disk', async () => {
    const { file, store, cleanup } = await tempFile();
    try {
      const http: SessionTarget = {
        transport: 'http',
        url: 'https://example.com/mcp',
        httpTransport: 'streamable-http',
        auth: { mode: 'bearer', token: 'super-secret-bearer-token' },
      };
      const { target, requiresToken } = sanitizeToStoredTarget(http);
      await store.create({
        id: deriveSessionId(http),
        createdAt: 0,
        lastUsedAt: 0,
        target,
        requiresToken,
      });
      const raw = await readFile(file, 'utf8');
      expect(raw).not.toContain('super-secret-bearer-token');
    } finally {
      await cleanup();
    }
  });

  it('updates lastUsedAt on touch', async () => {
    const { file, store, cleanup } = await tempFile();
    try {
      await store.create({
        id: 'stdio-x',
        createdAt: 1,
        lastUsedAt: 1,
        target: { transport: 'stdio', command: 'node fake.js' },
        requiresToken: false,
      });
      await store.touch('stdio-x');
      const reopened = new SessionStore(file);
      const reloaded = await reopened.get('stdio-x');
      expect(reloaded?.lastUsedAt).toBeGreaterThan(1);
    } finally {
      await cleanup();
    }
  });

  it('removes a session by id or name', async () => {
    const { store, cleanup } = await tempFile();
    try {
      await store.create({
        id: 'stdio-1',
        name: 'one',
        createdAt: 0,
        lastUsedAt: 0,
        target: { transport: 'stdio', command: 'node a.js' },
        requiresToken: false,
      });
      expect((await store.remove('one'))?.id).toBe('stdio-1');
      expect(await store.get('stdio-1')).toBeUndefined();
      expect(await store.remove('stdio-1')).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('throws a clear error on a corrupt store file', async () => {
    const { file, store, cleanup } = await tempFile();
    try {
      await import('node:fs/promises').then((fs) => fs.writeFile(file, 'not json', 'utf8'));
      await expect(store.list()).rejects.toThrow(SessionStoreError);
    } finally {
      await cleanup();
    }
  });
});
