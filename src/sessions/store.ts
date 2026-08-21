import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { redactDeep } from '../core/tracing/redaction.js';
import type { SessionTarget, StoredSession, StoredTarget } from './types.js';
import { sanitizeToStoredTarget } from './types.js';

export interface SessionStoreFile {
  version: 1;
  sessions: StoredSession[];
}

const STORE_VERSION = 1;

export function defaultSessionStorePath(): string {
  return resolve(process.cwd(), '.testmymcp', 'sessions.json');
}

export function deriveSessionId(target: SessionTarget): string {
  const { target: stored } = sanitizeToStoredTarget(target);
  const canonical = canonicalizeTarget(stored);
  const digest = createHash('sha256').update(canonical).digest('hex');
  return `${stored.transport}-${digest.slice(0, 10)}`;
}

function canonicalizeTarget(target: StoredTarget): string {
  if (target.transport === 'stdio') {
    return JSON.stringify({
      transport: 'stdio',
      command: target.command,
      era: target.era ?? null,
      version: target.version ?? null,
      maxLineBytes: target.maxLineBytes ?? null,
    });
  }
  return JSON.stringify({
    transport: 'http',
    url: target.url,
    httpTransport: target.httpTransport,
    authMode: target.authMode,
    era: target.era ?? null,
    version: target.version ?? null,
    accept: target.accept ?? null,
  });
}

export class SessionStoreError extends Error {}

export class SessionStore {
  constructor(private readonly file: string = defaultSessionStorePath()) {}

  async list(redactSecrets = true): Promise<StoredSession[]> {
    const sessions = await this.readAll();
    return redactSecrets ? sessions.map(redactSession) : sessions;
  }

  async get(idOrName: string): Promise<StoredSession | undefined> {
    const sessions = await this.readAll();
    return (
      sessions.find((session) => session.id === idOrName) ??
      sessions.find((session) => session.name === idOrName)
    );
  }

  async create(record: StoredSession): Promise<void> {
    const sessions = await this.readAll();
    const index = sessions.findIndex((session) => session.id === record.id);
    const existing = sessions[index];
    if (existing !== undefined) {
      sessions[index] = { ...existing, ...record };
    } else {
      sessions.push(record);
    }
    await this.writeAll(sessions);
  }

  async touch(id: string): Promise<void> {
    const sessions = await this.readAll();
    const index = sessions.findIndex((session) => session.id === id);
    const existing = sessions[index];
    if (existing === undefined) return;
    sessions[index] = { ...existing, lastUsedAt: Date.now() };
    await this.writeAll(sessions);
  }

  async remove(idOrName: string): Promise<StoredSession | undefined> {
    const sessions = await this.readAll();
    const removed = getByIdOrName(sessions, idOrName);
    if (removed === undefined) return undefined;
    await this.writeAll(sessions.filter((session) => session.id !== removed.id));
    return removed;
  }

  private async readAll(): Promise<StoredSession[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return [];
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SessionStoreError(`session store ${this.file} is not valid JSON`);
    }
    if (!isSessionStoreFile(parsed)) {
      throw new SessionStoreError(`session store ${this.file} has an unexpected shape`);
    }
    return parsed.sessions;
  }

  private async writeAll(sessions: StoredSession[]): Promise<void> {
    const payload: SessionStoreFile = { version: STORE_VERSION, sessions };
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(tmp, this.file);
  }
}

function getByIdOrName(sessions: StoredSession[], idOrName: string): StoredSession | undefined {
  return (
    sessions.find((session) => session.id === idOrName) ??
    sessions.find((session) => session.name === idOrName)
  );
}

function redactSession(session: StoredSession): StoredSession {
  return {
    ...session,
    target: redactDeep(session.target) as StoredTarget,
    name: session.name,
  };
}

function isSessionStoreFile(value: unknown): value is SessionStoreFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as SessionStoreFile).version === STORE_VERSION &&
    Array.isArray((value as SessionStoreFile).sessions)
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
