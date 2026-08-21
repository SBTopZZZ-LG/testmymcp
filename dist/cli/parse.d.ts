import type { ToolExecutionMode } from '../core/tools/safety.js';
import { type ProtocolEra, type ProtocolVersion } from '../core/types/protocol.js';
import type { HttpTransportKind } from '../sessions/types.js';
export declare function parseLevel(value: string): number;
export declare function parseMode(value: string): ToolExecutionMode;
export declare function parseEra(value: string): ProtocolEra;
export declare function parseProtocolVersion(value: string): ProtocolVersion;
export declare function parseHttpTransport(value: string): HttpTransportKind;
export declare function parseHttpAccept(value: string | undefined): 'json' | 'sse' | undefined;
