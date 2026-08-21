import { createLegacyProtocolAdapter } from '../../protocols/legacy/adapter.js';
import { createModernProtocolAdapter } from '../../protocols/modern/adapter.js';
import { eraOfVersion } from '../types/protocol.js';
export class UnsupportedProtocolVersionError extends Error {
    requested;
    constructor(requested) {
        super(`no adapter for protocol version/era "${requested}"`);
        this.name = 'UnsupportedProtocolVersionError';
        this.requested = requested;
    }
}
export class DefaultProtocolAdapterFactory {
    create(eraOrVersion, options) {
        const directEra = eraOfVersion(eraOrVersion);
        const era = eraOrVersion === 'legacy' || eraOrVersion === 'modern'
            ? eraOrVersion
            : (directEra ?? 'legacy');
        if (era === 'modern') {
            return createModernProtocolAdapter({
                transport: options.transport,
                clientInfo: options.clientInfo,
                clientCapabilities: options.clientCapabilities,
                preferVersion: options.preferVersion,
                requestTimeoutMs: options.requestTimeoutMs,
                discoverTimeoutMs: options.initTimeoutMs,
                shutdownTimeoutMs: options.shutdownTimeoutMs,
                idStyle: options.idStyle,
                clock: options.clock,
                trace: options.trace,
                extensions: options.extensions,
                autoMrtr: options.autoMrtr,
            });
        }
        return createLegacyProtocolAdapter({
            transport: options.transport,
            clientInfo: options.clientInfo,
            clientCapabilities: options.clientCapabilities,
            preferVersion: options.preferVersion,
            requestTimeoutMs: options.requestTimeoutMs,
            initTimeoutMs: options.initTimeoutMs,
            shutdownTimeoutMs: options.shutdownTimeoutMs,
            idStyle: options.idStyle,
            clock: options.clock,
            trace: options.trace,
        });
    }
}
export const protocolAdapterFactory = new DefaultProtocolAdapterFactory();
//# sourceMappingURL=factory.js.map