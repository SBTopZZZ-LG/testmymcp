export declare const PROTOCOL_VERSIONS: readonly ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"];
export type ProtocolVersion = (typeof PROTOCOL_VERSIONS)[number];
export type ProtocolEra = 'legacy' | 'modern';
export type TransportType = 'stdio' | 'streamable-http' | 'legacy-sse';
export declare const LEGACY_PROTOCOL_VERSIONS: readonly ProtocolVersion[];
export declare const MODERN_PROTOCOL_VERSIONS: readonly ProtocolVersion[];
export declare function isProtocolVersion(value: string): value is ProtocolVersion;
export declare function eraOfVersion(version: string): ProtocolEra | null;
export declare function sortKnownVersions(versions: Iterable<string>): ProtocolVersion[];
