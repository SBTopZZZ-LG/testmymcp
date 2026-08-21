import { toClientCapabilitiesJson } from '../../core/protocol/capabilities.js';
export const PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
export const CLIENT_INFO_KEY = 'io.modelcontextprotocol/clientInfo';
export const CLIENT_CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';
export const LOG_LEVEL_KEY = 'io.modelcontextprotocol/logLevel';
export function buildRequestMeta(options) {
    const meta = {
        [PROTOCOL_VERSION_KEY]: options.protocolVersion,
        [CLIENT_CAPABILITIES_KEY]: toClientCapabilitiesJson(options.clientCapabilities),
    };
    const clientInfo = options.clientInfo;
    if (clientInfo.name !== undefined || clientInfo.version !== undefined) {
        meta[CLIENT_INFO_KEY] = {
            name: clientInfo.name ?? 'testmymcp',
            version: clientInfo.version ?? '0.1.0',
        };
    }
    if (options.logLevel !== undefined)
        meta[LOG_LEVEL_KEY] = options.logLevel;
    if (options.progressToken !== undefined)
        meta.progressToken = options.progressToken;
    if (options.extra !== undefined) {
        for (const [key, value] of Object.entries(options.extra))
            meta[key] = value;
    }
    return meta;
}
/**
 * Attach `_meta` to a params object, preserving any existing request params.
 * The `_meta` field is injected at the top level of `params` per the modern spec.
 */
export function withRequestMeta(params, meta) {
    const metaObject = buildRequestMeta(meta);
    if (params === undefined)
        return { _meta: metaObject };
    return { ...params, _meta: metaObject };
}
//# sourceMappingURL=request-meta.js.map