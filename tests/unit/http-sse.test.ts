import { describe, expect, it } from 'vitest';

import { SseParser } from '../../src/transports/http/sse.js';

function parseAll(input: string): ReturnType<SseParser['push']> {
  const parser = new SseParser();
  return parser.push(input).concat(parser.flush());
}

describe('SSE parser', () => {
  it('parses a message event with JSON data', () => {
    const events = parseAll('event: message\ndata: {"jsonrpc":"2.0","id":1}\n\n');
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.kind).toBe('event');
    if (event?.kind === 'event') {
      expect(event.event.event).toBe('message');
      expect(event.event.data).toBe('{"jsonrpc":"2.0","id":1}');
    }
  });

  it('parses a legacy endpoint handshake event', () => {
    const events = parseAll('event: endpoint\ndata: /messages?sessionId=xyz\n\n');
    const event = events[0];
    expect(event?.kind).toBe('event');
    if (event?.kind === 'event') {
      expect(event.event.event).toBe('endpoint');
      expect(event.event.data).toBe('/messages?sessionId=xyz');
    }
  });

  it('joins multi-line data fields with newlines', () => {
    const events = parseAll('event: message\ndata: line1\ndata: line2\n\n');
    const event = events[0];
    expect(event?.kind).toBe('event');
    if (event?.kind === 'event') expect(event.event.data).toBe('line1\nline2');
  });

  it('tolerates CRLF line endings and leading comments', () => {
    const events = parseAll(': keep-alive\r\n\r\nevent: message\r\ndata: {}\r\n\r\n');
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.kind).toBe('event');
    if (event?.kind === 'event') expect(event.event.data).toBe('{}');
  });

  it('ignores an event with no fields (blank frame)', () => {
    const events = parseAll('\n\n');
    expect(events).toHaveLength(0);
  });

  it('handles events split across pushes', () => {
    const parser = new SseParser();
    const first = parser.push('event: message\nda');
    expect(first).toHaveLength(0);
    const second = parser.push('ta: {}\n\n').concat(parser.flush());
    expect(second).toHaveLength(1);
    const event = second[0];
    expect(event?.kind).toBe('event');
    if (event?.kind === 'event') expect(event.event.data).toBe('{}');
  });

  it('errors when a single frame exceeds maxEventBytes', () => {
    const parser = new SseParser({ maxEventBytes: 10 });
    const events = parser.push(
      'event: message\ndata: this is a very long data payload exceeding the cap\n\n',
    );
    expect(events.some((e) => e.kind === 'error')).toBe(true);
  });
});
