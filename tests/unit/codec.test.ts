import { describe, expect, it } from 'vitest';
import { CodecError, encodeNdjson, NdjsonReader, parseNdjsonLine } from '../../src/core/jsonrpc/codec.js';

describe('NDJSON codec', () => {
  it('round-trips a message', () => {
    const message = { jsonrpc: '2.0', id: 1, method: 'ping' };
    expect(parseNdjsonLine(encodeNdjson(message))).toEqual(message);
  });

  it('encodes exactly one line per message', () => {
    const line = encodeNdjson({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(line).toBe('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  });

  it('throws CodecError on garbage lines without swallowing the offending line', () => {
    expect(() => parseNdjsonLine('Starting server...')).toThrow(CodecError);
    try {
      parseNdjsonLine('not json');
      throw new Error('should not reach');
    } catch (error) {
      if (error instanceof CodecError) {
        expect(error.line).toBe('not json');
      } else {
        throw error;
      }
    }
  });

  it('buffers partial lines across pushes', () => {
    const reader = new NdjsonReader();
    expect(reader.push('{"jsonrpc":"2.0","id":1')).toEqual([]);
    expect(reader.push(',"method":"ping"}\n')).toEqual([
      { kind: 'message', message: { jsonrpc: '2.0', id: 1, method: 'ping' } },
    ]);
  });

  it('handles multiple messages arriving in one chunk', () => {
    const reader = new NdjsonReader();
    const events = reader.push('{"jsonrpc":"2.0","id":1,"method":"init"}\n{"jsonrpc":"2.0","id":2,"method":"list"}\n');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: 'message', message: { id: 1 } });
    expect(events[1]).toMatchObject({ kind: 'message', message: { id: 2 } });
  });

  it('classifies unparseable lines as garbage instead of throwing', () => {
    const reader = new NdjsonReader();
    const events = reader.push('Starting server...\n{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    expect(events).toEqual([
      { kind: 'garbage', line: 'Starting server...' },
      { kind: 'message', message: { jsonrpc: '2.0', id: 1, method: 'ping' } },
    ]);
  });

  it('emits every complete line through the onLine callback', () => {
    const lines: string[] = [];
    const reader = new NdjsonReader({ onLine: (line) => lines.push(line) });
    reader.push('{"a":1}\n{"a":2}\n');
    expect(lines).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('skips blank lines', () => {
    const reader = new NdjsonReader();
    expect(reader.push('\n\n{"jsonrpc":"2.0","id":1,"method":"ping"}\n')).toHaveLength(1);
  });

  it('preserves UTF-8 correctness across chunk boundaries', () => {
    const reader = new NdjsonReader();
    const line = encodeNdjson({ jsonrpc: '2.0', id: 1, method: 'emoji', params: { text: '😭ಕನ್ನಡ日本語' } });
    const bytes = new TextEncoder().encode(line);
    const split = Math.floor(bytes.length / 2);
    const first = reader.push(bytes.subarray(0, split));
    const second = reader.push(bytes.subarray(split));
    expect(first).toEqual([]);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ kind: 'message', message: { params: { text: '😭ಕನ್ನಡ日本語' } } });
  });

  it('flushes a trailing message without a newline', () => {
    const reader = new NdjsonReader();
    reader.push('{"jsonrpc":"2.0","id":9,"method":"ping"}');
    expect(reader.flush()).toEqual([{ kind: 'message', message: { jsonrpc: '2.0', id: 9, method: 'ping' } }]);
    expect(reader.flush()).toEqual([]);
  });

  it('emits an oversize event and drops the line when it exceeds maxBytes', () => {
    const reader = new NdjsonReader({ maxBytes: 16 });
    const events = reader.push('{"jsonrpc":"2.0","id":10,"method":"a"'.repeat(3));
    expect(events).toEqual([{ kind: 'oversize', bytes: expect.any(Number) }]);
    expect(reader.bufferedBytes).toBe(0);
  });

  it('tracks the number of buffered bytes for a partial line', () => {
    const reader = new NdjsonReader();
    expect(reader.bufferedBytes).toBe(0);
    reader.push('{"a":1');
    expect(reader.bufferedBytes).toBeGreaterThan(0);
    reader.push('}\n');
    expect(reader.bufferedBytes).toBe(0);
  });
});