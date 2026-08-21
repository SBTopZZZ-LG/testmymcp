import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { redactDeep } from '../core/tracing/redaction.js';
import { sanitizeToStoredTarget } from './types.js';
const STORE_VERSION = 1;
export function defaultSessionStorePath() {
    return resolve(process.cwd(), '.testmymcp', 'sessions.json');
}
export function deriveSessionId(target) {
    const { target: stored } = sanitizeToStoredTarget(target);
    const canonical = canonicalizeTarget(stored);
    const digest = createHash('sha256').update(canonical).digest('hex');
    return `${stored.transport}-${digest.slice(0, 10)}`;
}
function canonicalizeTarget(target) {
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
export class SessionStoreError extends Error {
}
export class SessionStore {
    file;
    constructor(file = defaultSessionStorePath()) {
        this.file = file;
    }
    async list(redactSecrets = true) {
        const sessions = await this.readAll();
        return redactSecrets ? sessions.map(redactSession) : sessions;
    }
    async get(idOrName) {
        const sessions = await this.readAll();
        return (sessions.find((session) => session.id === idOrName) ??
            sessions.find((session) => session.name === idOrName));
    }
    async create(record) {
        const sessions = await this.readAll();
        const index = sessions.findIndex((session) => session.id === record.id);
        const existing = sessions[index];
        if (existing !== undefined) {
            sessions[index] = { ...existing, ...record };
        }
        else {
            sessions.push(record);
        }
        await this.writeAll(sessions);
    }
    async touch(id) {
        const sessions = await this.readAll();
        const index = sessions.findIndex((session) => session.id === id);
        const existing = sessions[index];
        if (existing === undefined)
            return;
        sessions[index] = { ...existing, lastUsedAt: Date.now() };
        await this.writeAll(sessions);
    }
    async remove(idOrName) {
        const sessions = await this.readAll();
        const removed = getByIdOrName(sessions, idOrName);
        if (removed === undefined)
            return undefined;
        await this.writeAll(sessions.filter((session) => session.id !== removed.id));
        return removed;
    }
    async readAll() {
        let raw;
        try {
            raw = await readFile(this.file, 'utf8');
        }
        catch (error) {
            if (isNodeError(error) && error.code === 'ENOENT')
                return [];
            throw error;
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            throw new SessionStoreError(`session store ${this.file} is not valid JSON`);
        }
        if (!isSessionStoreFile(parsed)) {
            throw new SessionStoreError(`session store ${this.file} has an unexpected shape`);
        }
        return parsed.sessions;
    }
    async writeAll(sessions) {
        const payload = { version: STORE_VERSION, sessions };
        await mkdir(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        await rename(tmp, this.file);
    }
}
function getByIdOrName(sessions, idOrName) {
    return (sessions.find((session) => session.id === idOrName) ??
        sessions.find((session) => session.name === idOrName));
}
function redactSession(session) {
    return {
        ...session,
        target: redactDeep(session.target),
        name: session.name,
    };
}
function isSessionStoreFile(value) {
    return (typeof value === 'object' &&
        value !== null &&
        value.version === STORE_VERSION &&
        Array.isArray(value.sessions));
}
function isNodeError(error) {
    return error instanceof Error && 'code' in error;
}
//# sourceMappingURL=store.js.map