import { parseServerCapabilities, } from '../../core/protocol/capabilities.js';
import { isProtocolVersion } from '../../core/types/protocol.js';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseDiscoverResult(result) {
    if (!isRecord(result))
        throw new Error('server/discover result is not an object');
    const supportedVersions = Array.isArray(result.supportedVersions)
        ? result.supportedVersions.filter((v) => typeof v === 'string')
        : [];
    const rawCapabilities = isRecord(result.capabilities) ? result.capabilities : {};
    const serverInfoRaw = isRecord(result._meta)
        ? isRecord(result._meta['io.modelcontextprotocol/serverInfo'])
            ? result._meta['io.modelcontextprotocol/serverInfo']
            : undefined
        : undefined;
    const serverInfo = {
        name: typeof serverInfoRaw?.name === 'string' ? serverInfoRaw.name : undefined,
        version: typeof serverInfoRaw?.version === 'string' ? serverInfoRaw.version : undefined,
    };
    return {
        supportedVersions,
        capabilities: parseServerCapabilities(rawCapabilities, '2026-07-28'),
        serverInfo,
        instructions: typeof result.instructions === 'string' ? result.instructions : undefined,
        ttlMs: typeof result.ttlMs === 'number' ? result.ttlMs : undefined,
        cacheScope: result.cacheScope === 'public' || result.cacheScope === 'private'
            ? result.cacheScope
            : undefined,
        raw: result,
    };
}
export function selectSupportedVersion(supported, preferred) {
    const known = supported.filter((v) => isProtocolVersion(v));
    if (known.includes(preferred))
        return preferred;
    if (known.includes('2026-07-28'))
        return '2026-07-28';
    return known[0];
}
//# sourceMappingURL=discover.js.map