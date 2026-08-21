export declare class CodecError extends Error {
    readonly line: string;
    readonly causeError?: Error;
    constructor(message: string, line: string, causeError?: Error);
}
export declare function encodeNdjson(message: unknown): string;
export declare function parseNdjsonLine(line: string): unknown;
export type NdjsonEvent = {
    kind: 'message';
    message: unknown;
} | {
    kind: 'garbage';
    line: string;
} | {
    kind: 'oversize';
    bytes: number;
};
export interface NdjsonReaderOptions {
    encoding?: string;
    onLine?: (line: string) => void;
    maxBytes?: number;
}
export declare class NdjsonReader {
    private buffer;
    private buffered;
    private readonly decoder;
    private readonly onLine?;
    private readonly maxBytes?;
    constructor(options?: NdjsonReaderOptions);
    get bufferedBytes(): number;
    push(chunk: Uint8Array | string): NdjsonEvent[];
    flush(): NdjsonEvent[];
}
