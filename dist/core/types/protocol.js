export const PROTOCOL_VERSIONS = [
    '2024-11-05',
    '2025-03-26',
    '2025-06-18',
    '2025-11-25',
    '2026-07-28',
];
export const LEGACY_PROTOCOL_VERSIONS = PROTOCOL_VERSIONS.filter((version) => version !== '2026-07-28');
export const MODERN_PROTOCOL_VERSIONS = ['2026-07-28'];
const ERA_BY_VERSION = new Map([
    ...LEGACY_PROTOCOL_VERSIONS.map((version) => [version, 'legacy']),
    ...MODERN_PROTOCOL_VERSIONS.map((version) => [version, 'modern']),
]);
export function isProtocolVersion(value) {
    return PROTOCOL_VERSIONS.includes(value);
}
export function eraOfVersion(version) {
    if (!isProtocolVersion(version))
        return null;
    return ERA_BY_VERSION.get(version) ?? null;
}
const KNOWN_ORDER = new Map(PROTOCOL_VERSIONS.map((version, index) => [version, index]));
export function sortKnownVersions(versions) {
    return Array.from(versions)
        .filter(isProtocolVersion)
        .sort((a, b) => (KNOWN_ORDER.get(a) ?? 0) - (KNOWN_ORDER.get(b) ?? 0));
}
//# sourceMappingURL=protocol.js.map