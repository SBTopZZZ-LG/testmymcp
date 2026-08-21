export declare const REDACTED = "REDACTED";
export declare function isSensitiveKey(key: string): boolean;
export declare function redactString(input: string): string;
export declare function redactDeep(value: unknown, seen?: WeakSet<object>): unknown;
