export class CodecError extends Error {
    line;
    causeError;
    constructor(message, line, causeError) {
        super(`${message}: ${line}`);
        this.name = 'CodecError';
        this.line = line;
        this.causeError = causeError;
    }
}
export function encodeNdjson(message) {
    return JSON.stringify(message) + '\n';
}
export function parseNdjsonLine(line) {
    const trimmed = line.trim();
    try {
        return JSON.parse(trimmed);
    }
    catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        throw new CodecError('invalid JSON line', trimmed, error);
    }
}
export class NdjsonReader {
    buffer = '';
    buffered = 0;
    decoder;
    onLine;
    maxBytes;
    constructor(options = {}) {
        this.decoder = new TextDecoder(options.encoding ?? 'utf-8');
        this.onLine = options.onLine;
        this.maxBytes = options.maxBytes;
    }
    get bufferedBytes() {
        return this.buffered;
    }
    push(chunk) {
        let incomingBytes;
        if (typeof chunk === 'string') {
            this.buffer += chunk;
            incomingBytes = Buffer.byteLength(chunk, 'utf8');
        }
        else {
            this.buffer += this.decoder.decode(chunk, { stream: true });
            incomingBytes = chunk.byteLength;
        }
        this.buffered += incomingBytes;
        const events = [];
        if (this.maxBytes !== undefined && this.buffered > this.maxBytes) {
            events.push({ kind: 'oversize', bytes: this.buffered });
            this.buffer = '';
            this.buffered = 0;
            return events;
        }
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';
        this.buffered = Buffer.byteLength(this.buffer, 'utf8');
        for (const raw of lines) {
            const line = raw.trim();
            if (line.length === 0)
                continue;
            this.onLine?.(line);
            try {
                events.push({ kind: 'message', message: parseNdjsonLine(line) });
            }
            catch {
                events.push({ kind: 'garbage', line });
            }
        }
        return events;
    }
    flush() {
        const remaining = this.buffer.trim();
        this.buffer = '';
        this.buffered = 0;
        if (remaining.length === 0)
            return [];
        this.onLine?.(remaining);
        try {
            return [{ kind: 'message', message: parseNdjsonLine(remaining) }];
        }
        catch {
            return [{ kind: 'garbage', line: remaining }];
        }
    }
}
//# sourceMappingURL=codec.js.map