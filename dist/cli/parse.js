import { isProtocolVersion, } from '../core/types/protocol.js';
export function parseLevel(value) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 7) {
        throw new Error(`invalid level "${value}" (expected 0-7)`);
    }
    return parsed;
}
export function parseMode(value) {
    if (value === 'safe' || value === 'readonly' || value === 'all')
        return value;
    throw new Error(`invalid mode "${value}" (expected safe, readonly or all)`);
}
export function parseEra(value) {
    if (value === 'legacy' || value === 'modern')
        return value;
    throw new Error(`invalid era "${value}" (expected legacy or modern)`);
}
export function parseProtocolVersion(value) {
    if (!isProtocolVersion(value))
        throw new Error(`invalid protocol version "${value}"`);
    return value;
}
export function parseHttpTransport(value) {
    if (value === 'streamable-http' || value === 'legacy-sse')
        return value;
    throw new Error(`invalid transport "${value}" (expected streamable-http or legacy-sse)`);
}
export function parseHttpAccept(value) {
    if (value === undefined)
        return undefined;
    if (value === 'json' || value === 'sse')
        return value;
    throw new Error(`invalid accept "${value}" (expected json or sse)`);
}
//# sourceMappingURL=parse.js.map