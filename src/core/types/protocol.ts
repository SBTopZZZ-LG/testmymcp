export const PROTOCOL_VERSIONS = [
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
  '2026-07-28',
] as const;

export type ProtocolVersion = (typeof PROTOCOL_VERSIONS)[number];

export type ProtocolEra = 'legacy' | 'modern';

export type TransportType = 'stdio' | 'streamable-http' | 'legacy-sse';

export const LEGACY_PROTOCOL_VERSIONS: readonly ProtocolVersion[] = PROTOCOL_VERSIONS.filter(
  (version) => version !== '2026-07-28',
);

export const MODERN_PROTOCOL_VERSIONS: readonly ProtocolVersion[] = ['2026-07-28'];

const ERA_BY_VERSION = new Map<ProtocolVersion, ProtocolEra>([
  ...LEGACY_PROTOCOL_VERSIONS.map((version) => [version, 'legacy'] as const),
  ...MODERN_PROTOCOL_VERSIONS.map((version) => [version, 'modern'] as const),
]);

export function isProtocolVersion(value: string): value is ProtocolVersion {
  return (PROTOCOL_VERSIONS as readonly string[]).includes(value);
}

export function eraOfVersion(version: string): ProtocolEra | null {
  if (!isProtocolVersion(version)) return null;
  return ERA_BY_VERSION.get(version) ?? null;
}

const KNOWN_ORDER = new Map(PROTOCOL_VERSIONS.map((version, index) => [version, index]));

export function sortKnownVersions(versions: Iterable<string>): ProtocolVersion[] {
  return Array.from(versions)
    .filter(isProtocolVersion)
    .sort((a, b) => (KNOWN_ORDER.get(a) ?? 0) - (KNOWN_ORDER.get(b) ?? 0));
}