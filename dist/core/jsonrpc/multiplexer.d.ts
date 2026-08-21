import { type TimeoutKind } from '../timeouts/deadline.js';
import type { JsonRpcId, JsonRpcRequest, JsonRpcResponse } from './messages.js';
export declare class DuplicateRequestIdError extends Error {
    readonly id: JsonRpcId;
    constructor(id: JsonRpcId);
}
export declare class JsonRpcRemoteError extends Error {
    readonly code: number;
    readonly data?: unknown;
    constructor(code: number, message: string, data?: unknown);
}
export interface MultiplexerOptions {
    timeoutMs?: number;
    clock?: () => number;
}
export declare class RequestMultiplexer {
    private readonly pending;
    private readonly clock;
    private readonly defaultTimeoutMs?;
    constructor(options?: MultiplexerOptions);
    get pendingCount(): number;
    get pendingIds(): JsonRpcId[];
    isPending(id: JsonRpcId): boolean;
    register(request: JsonRpcRequest, timeoutMs?: number, timeoutKind?: TimeoutKind): Promise<JsonRpcResponse>;
    handleMessage(message: unknown): void;
    failById(id: JsonRpcId, error: Error): void;
    failAll(error: Error): void;
}
