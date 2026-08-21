import { describe, expect, it } from 'vitest';

import { REDACTED } from '../../src/core/tracing/redaction.js';
import { TraceStore } from '../../src/core/tracing/store.js';

describe('TraceStore', () => {
  it('redacts sensitive payloads by default', () => {
    const store = new TraceStore();
    store.add({
      direction: 'out',
      kind: 'request',
      transport: 'stdio',
      method: 'initialize',
      requestId: 1,
      payload: { headers: { Authorization: 'Bearer secret' } },
      timestamp: 0,
    });
    const message = store.all()[0];
    expect(message?.payload).toMatchObject({ headers: { Authorization: REDACTED } });
  });

  it('keeps secrets when explicitly requested', () => {
    const store = new TraceStore({ showSecrets: true });
    store.add({
      direction: 'out',
      kind: 'request',
      transport: 'stdio',
      method: 'initialize',
      requestId: 1,
      payload: { headers: { Authorization: 'Bearer secret' } },
      timestamp: 0,
    });
    expect(store.all()[0]?.payload).toMatchObject({ headers: { Authorization: 'Bearer secret' } });
  });

  it('can disable redaction entirely', () => {
    const store = new TraceStore({ redact: false });
    store.add({
      direction: 'in',
      kind: 'response',
      transport: 'stdio',
      requestId: 1,
      payload: { access_token: 'keep-me' },
      timestamp: 0,
    });
    expect(store.all()[0]?.payload).toMatchObject({ access_token: 'keep-me' });
  });

  it('indexes by request id and method', () => {
    const store = new TraceStore({ redact: false });
    store.add({ direction: 'out', kind: 'request', method: 'ping', requestId: 3, timestamp: 0 });
    store.add({ direction: 'in', kind: 'response', method: 'ping', requestId: 3, timestamp: 1 });
    store.add({
      direction: 'out',
      kind: 'request',
      method: 'tools/list',
      requestId: 4,
      timestamp: 2,
    });

    expect(store.byRequestId(3)).toHaveLength(2);
    expect(store.byRequestId(4)).toHaveLength(1);
    expect(store.byMethod('ping')).toHaveLength(2);
  });

  it('sorts the timeline by timestamp', () => {
    const store = new TraceStore({ redact: false });
    store.add({ direction: 'out', kind: 'request', method: 'ping', requestId: 1, timestamp: 100 });
    store.add({ direction: 'in', kind: 'stderr', timestamp: 5, raw: 'log line' });
    store.add({ direction: 'in', kind: 'response', requestId: 1, timestamp: 150 });

    const timeline = store.timeline();
    expect(timeline.map((message) => message.timestamp)).toEqual([5, 100, 150]);
  });

  it('serializes to a stable mcp-trace JSON shape', () => {
    const store = new TraceStore({ redact: false });
    store.add({ direction: 'out', kind: 'request', method: 'ping', requestId: 1, timestamp: 0 });
    const json = store.toJSON();
    expect(json.kind).toBe('mcp-trace');
    expect(json.count).toBe(1);
    expect(json.messages).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it('clears all entries', () => {
    const store = new TraceStore({ redact: false });
    store.add({ direction: 'out', kind: 'request', method: 'ping', requestId: 1, timestamp: 0 });
    expect(store.size).toBe(1);
    store.clear();
    expect(store.size).toBe(0);
  });
});
