import type { SessionTarget, StoredSession } from './types.js';
export interface SessionStoreFile {
    version: 1;
    sessions: StoredSession[];
}
export declare function defaultSessionStorePath(): string;
export declare function deriveSessionId(target: SessionTarget): string;
export declare class SessionStoreError extends Error {
}
export declare class SessionStore {
    private readonly file;
    constructor(file?: string);
    list(redactSecrets?: boolean): Promise<StoredSession[]>;
    get(idOrName: string): Promise<StoredSession | undefined>;
    create(record: StoredSession): Promise<void>;
    touch(id: string): Promise<void>;
    remove(idOrName: string): Promise<StoredSession | undefined>;
    private readAll;
    private writeAll;
}
