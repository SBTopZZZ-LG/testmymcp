import { parseServerCapabilities, toClientCapabilitiesJson, } from '../../core/protocol/capabilities.js';
import { isProtocolVersion } from '../../core/types/protocol.js';
export function buildInitializeParams(options) {
    return {
        protocolVersion: options.protocolVersion,
        capabilities: toClientCapabilitiesJson(options.clientCapabilities),
        clientInfo: {
            name: options.clientInfo.name ?? 'testmymcp',
            version: options.clientInfo.version ?? '0.1.0',
        },
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseInitializeResult(result) {
    if (!isRecord(result))
        throw new Error('initialize result is not an object');
    if (typeof result.protocolVersion !== 'string') {
        throw new Error('initialize result is missing protocolVersion');
    }
    if (!isProtocolVersion(result.protocolVersion)) {
        throw new Error(`initialize returned unknown protocol version "${result.protocolVersion}"`);
    }
    const serverInfoRaw = isRecord(result.serverInfo) ? result.serverInfo : undefined;
    const serverInfo = {
        name: typeof serverInfoRaw?.name === 'string' ? serverInfoRaw.name : undefined,
        version: typeof serverInfoRaw?.version === 'string' ? serverInfoRaw.version : undefined,
    };
    return {
        protocolVersion: result.protocolVersion,
        serverInfo,
        serverCapabilities: parseServerCapabilities(result.capabilities, result.protocolVersion),
        raw: result,
    };
}
//# sourceMappingURL=initialize.js.map