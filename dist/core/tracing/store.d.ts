import type { TraceMessage, TraceStoreJson } from '../types/trace.js';
export interface TraceStoreOptions {
    redact?: boolean;
    showSecrets?: boolean;
    maxEntries?: number;
}
export type TraceInput = Omit<TraceMessage, 'id' | 'timestamp'> & {
    id?: string;
    timestamp?: number;
};
export declare class TraceStore {
    private readonly messages;
    private readonly redact;
    private readonly showSecrets;
    private readonly maxEntries;
    constructor(options?: TraceStoreOptions);
    get size(): number;
    get isTruncated(): boolean;
    add(input: TraceInput): TraceMessage;
    all(): readonly TraceMessage[];
    byRequestId(requestId: TraceMessage['requestId']): TraceMessage[];
    byMethod(method: string): TraceMessage[];
    timeline(): TraceMessage[];
    clear(): void;
    toJSON(): TraceStoreJson;
}
