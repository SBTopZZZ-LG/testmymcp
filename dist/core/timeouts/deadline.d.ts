export type TimeoutKind = 'connect' | 'initialize' | 'request' | 'tool' | 'test';
export declare class TimeoutError extends Error {
    readonly kind: TimeoutKind;
    readonly timeoutMs: number;
    constructor(kind: TimeoutKind, timeoutMs: number, message?: string);
}
export interface DeadlineOptions {
    kind: TimeoutKind;
    ms: number;
    message?: string;
}
export declare function withDeadline<T>(options: DeadlineOptions, task: (signal: AbortSignal) => Promise<T>): Promise<T>;
export declare function delay(ms: number): Promise<void>;
