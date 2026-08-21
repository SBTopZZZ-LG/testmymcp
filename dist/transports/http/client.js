import { request } from 'undici';
function buildHeaders(headers, auth) {
    const out = {};
    if (headers !== undefined) {
        for (const [key, value] of Object.entries(headers)) {
            if (value !== undefined)
                out[key] = value;
        }
    }
    if (auth !== undefined && auth.mode === 'bearer' && auth.token !== undefined) {
        out.Authorization = `Bearer ${auth.token}`;
    }
    return out;
}
function isSse(headers) {
    const contentType = normalizeHeader(headers, 'content-type');
    if (contentType === undefined)
        return false;
    const base = contentType.split(';', 1)[0]?.trim().toLowerCase();
    return base === 'text/event-stream';
}
export async function postJson(url, options) {
    const headers = buildHeaders(options.headers, options.auth);
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const response = await request(url, {
        method: options.method,
        headers,
        body,
        headersTimeout: options.timeoutMs,
        bodyTimeout: options.timeoutMs,
    });
    const contentType = normalizeHeader(response.headers, 'content-type');
    return {
        statusCode: response.statusCode,
        statusText: response.statusText,
        headers: response.headers,
        contentType,
        isEventStream: isSse(response.headers),
        text: () => response.body.text(),
        json: () => response.body.json(),
        stream: () => response.body,
    };
}
/**
 * Case-insensitive header lookup that tolerates both classic plain-object
 * headers and undici's `HeadersList` (array/iterator of `[name, value]`
 * pairs with proxied named access).
 */
export function normalizeHeader(headers, name) {
    const lower = name.toLowerCase();
    if (headers === null || typeof headers !== 'object')
        return undefined;
    const record = headers;
    // 1) Direct proxied/plain key access (headers["content-type"]).
    const direct = record[lower];
    if (typeof direct === 'string')
        return direct;
    if (Array.isArray(direct))
        return direct[0];
    // 2) Plain object with differently-cased keys.
    for (const key of Object.keys(record)) {
        if (key.toLowerCase() === lower) {
            const value = record[key];
            if (typeof value === 'string')
                return value;
            if (Array.isArray(value))
                return value[0];
        }
    }
    // 3) Iterable of [name, value] pairs (HeadersList iteration).
    const iterable = record;
    if (typeof iterable?.[Symbol.iterator] === 'function') {
        for (const item of iterable) {
            if (Array.isArray(item) && typeof item[0] === 'string' && item[0].toLowerCase() === lower) {
                const value = item[1];
                return Array.isArray(value) ? value[0] : String(value);
            }
        }
    }
    return undefined;
}
export function readBodyText(body) {
    return body.text();
}
//# sourceMappingURL=client.js.map