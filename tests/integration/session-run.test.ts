import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SessionStore, deriveSessionId, probeTarget, runTarget } from '../../src/sessions/index.js';
import type { SessionTarget } from '../../src/sessions/index.js';
import { expandStoredTarget, sanitizeToStoredTarget } from '../../src/sessions/types.js';

const stdioFixture = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/fake-server.js');
const httpFixture = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/http-server.js');

function stdioCommand(flags = ''): string {
  return `node "${stdioFixture}" ${flags}`.trim();
}

interface Fixture {
  port: number;
  kill(): Promise<void>;
}

function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 30000);
}

async function startHttpFixture(): Promise<Fixture> {
  const port = randomPort();
  const child = spawn(process.execPath, [httpFixture, '--port', String(port)], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await new Promise<void>((resolvePort, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`fixture startup timed out; stderr: ${stderr}`)), 10_000);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      const match = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(stderr);
      if (match !== null && match[1] !== undefined) {
        clearTimeout(timer);
        resolvePort();
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`fixture exited early with code ${code}; stderr: ${stderr}`));
    });
  });
  return {
    port,
    kill: () =>
      new Promise<void>((resolveKill) => {
        if (child.exitCode !== null) return resolveKill();
        child.once('exit', () => resolveKill());
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).once('exit', () =>
            setTimeout(resolveKill, 100),
          );
        } else {
          child.kill('SIGTERM');
          setTimeout(resolveKill, 300);
        }
      }),
  };
}

describe('session create/probe', () => {
  it('probes a stdio server and captures negotiated metadata', async () => {
    const target: SessionTarget = { transport: 'stdio', command: stdioCommand() };
    const negotiated = await probeTarget(target, { timeoutMs: 15_000, showSecrets: true });
    expect(negotiated.serverInfo.name).toBe('fake-mcp-server');
    expect(negotiated.protocolVersion).toBe('2025-11-25');
  });

  it('probes a streamable-http server', async () => {
    const fixture = await startHttpFixture();
    try {
      const target: SessionTarget = {
        transport: 'http',
        url: `http://127.0.0.1:${fixture.port}/`,
        httpTransport: 'streamable-http',
      };
      const negotiated = await probeTarget(target, { timeoutMs: 15_000, showSecrets: true });
      expect(negotiated.serverInfo.name).toBe('fake-mcp-server');
      expect(negotiated.protocolVersion).toBe('2025-11-25');
    } finally {
      await fixture.kill();
    }
  });
});

describe('session reuse via store + runTarget', () => {
  it('runs a persisted stdio session and reconnects from the stored config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tmcp-int-'));
    const file = join(dir, 'sessions.json');

    try {
      const store = new SessionStore(file);
      const target: SessionTarget = { transport: 'stdio', command: stdioCommand() };
      const id = deriveSessionId(target);
      const { target: stored, requiresToken, requiresSecretEnv } = sanitizeToStoredTarget(target);
      expect(requiresSecretEnv).toBe(false);
      await store.create({
        id,
        createdAt: 0,
        lastUsedAt: 0,
        target: stored,
        requiresToken,
        requiresSecretEnv,
      });

      const reopened = new SessionStore(file);
      const record = await reopened.get(id);
      expect(record).toBeDefined();
      if (record === undefined) throw new Error('session not found');

      const expanded = expandStoredTarget(record.target);
      const { results, meta } = await runTarget(expanded, {
        mode: 'safe',
        level: 3,
        timeoutMs: 15_000,
        showSecrets: true,
      });
      expect(results.some((r) => r.status === 'fail')).toBe(false);
      expect(results.map((r) => r.id)).toContain('protocol initialize');
      expect(meta.serverName).toBe('fake-mcp-server');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('runs a persisted http session using a re-supplied token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tmcp-int-'));
    const file = join(dir, 'sessions.json');

    const fixture = await startHttpFixture();
    try {
      const token = 'int-test-secret-token';
      const target: SessionTarget = {
        transport: 'http',
        url: `http://127.0.0.1:${fixture.port}/`,
        httpTransport: 'streamable-http',
        auth: { mode: 'bearer', token },
      };
      const id = deriveSessionId(target);
      const { target: stored, requiresToken, requiresSecretEnv } = sanitizeToStoredTarget(target);
      expect(requiresToken).toBe(true);
      expect(requiresSecretEnv).toBe(false);

      const store = new SessionStore(file);
      await store.create({ id, createdAt: 0, lastUsedAt: 0, target: stored, requiresToken, requiresSecretEnv });

      const raw = await readFile(file, 'utf8');
      expect(raw).not.toContain(token);

      const reopened = new SessionStore(file);
      const record = await reopened.get(id);
      expect(record).toBeDefined();

      const expanded = expandStoredTarget(stored, token);
      const { results, meta } = await runTarget(expanded, {
        mode: 'safe',
        level: 3,
        timeoutMs: 15_000,
        showSecrets: true,
      });
      expect(results.some((r) => r.status === 'fail')).toBe(false);
      expect(meta.protocolEra).toBe('legacy');
    } finally {
      await fixture.kill();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
