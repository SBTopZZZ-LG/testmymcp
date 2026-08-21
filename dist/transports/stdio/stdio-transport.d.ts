import type { ExitInfo, Transport, TransportObserver } from '../transport.js';
export interface StdioTransportOptions {
    command: string;
    maxLineBytes?: number;
    shutdownTimeoutMs?: number;
    /** Env vars merged over the current process environment for the child. */
    env?: Record<string, string>;
}
export declare class StdioTransport implements Transport {
    readonly kind: "stdio";
    observer?: TransportObserver;
    private readonly options;
    private child;
    private reader;
    private lastExit;
    private stderrLog;
    private stderrPartial;
    private stopping;
    constructor(options: StdioTransportOptions);
    get stderrLines(): readonly string[];
    get exited(): ExitInfo | null;
    isOpen(): boolean;
    start(): Promise<void>;
    send(message: unknown): Promise<void>;
    stop(): Promise<void>;
    private terminateTree;
    private waitForExit;
    private handleStdout;
    private handleStderr;
    private emitStderr;
    private checkLineSize;
}
