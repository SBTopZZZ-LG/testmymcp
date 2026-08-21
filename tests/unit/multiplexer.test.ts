import { describe, expect, it } from 'vitest';
import {
  createErrorResponse,
  createNotification,
  createRequest,
  createResponse,
} from '../../src/core/jsonrpc/messages.js';
import {
  DuplicateRequestIdError,
  JsonRpcRemoteError,
  RequestMultiplexer,
} from '../../src/core/jsonrpc/multiplexer.js';
import { TimeoutError } from '../../src/core/timeouts/deadline.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('RequestMultiplexer', () => {
  it('resolves requests by matching id regardless of response order', async () => {
    const multiplexer = new RequestMultiplexer();
    const first = createRequest(1, 'tools/call', { name: 'a' });
    const second = createRequest('abc', 'tools/call', { name: 'b' });
    const promiseA = multiplexer.register(first);
    const promiseB = multiplexer.register(second);

    expect(multiplexer.pendingCount).toBe(2);
    expect(multiplexer.isPending(1)).toBe(true);
    expect(multiplexer.isPending('abc')).toBe(true);

    multiplexer.handleMessage(createResponse('abc', { result: 'b-done' }));
    multiplexer.handleMessage(createResponse(1, { result: 'a-done' }));

    await expect(promiseB).resolves.toMatchObject({ result: { result: 'b-done' } });
    await expect(promiseA).resolves.toMatchObject({ result: { result: 'a-done' } });
    expect(multiplexer.pendingCount).toBe(0);
  });

  it('keeps string and numeric ids distinct', async () => {
    const multiplexer = new RequestMultiplexer();
    const numeric = multiplexer.register(createRequest(7, 'ping'));
    const textual = multiplexer.register(createRequest('7', 'ping'));
    expect(multiplexer.pendingCount).toBe(2);
    multiplexer.handleMessage(createResponse('7', 'textual'));
    multiplexer.handleMessage(createResponse(7, 'numeric'));
    await expect(numeric).resolves.toMatchObject({ result: 'numeric' });
    await expect(textual).resolves.toMatchObject({ result: 'textual' });
  });

  it('rejects duplicate pending ids', async () => {
    const multiplexer = new RequestMultiplexer();
    multiplexer.register(createRequest(1, 'ping'));
    await expect(multiplexer.register(createRequest(1, 'ping'))).rejects.toThrow(DuplicateRequestIdError);
  });

  it('ignores responses with unknown ids', async () => {
    const multiplexer = new RequestMultiplexer();
    expect(() => multiplexer.handleMessage(createResponse(999, 'ghost'))).not.toThrow();
    expect(multiplexer.pendingCount).toBe(0);
  });

  it('exposes the pending request ids', async () => {
    const multiplexer = new RequestMultiplexer();
    const p1 = multiplexer.register(createRequest(1, 'ping'), 500);
    multiplexer.register(createRequest('abc', 'ping'), 500);
    expect(multiplexer.pendingIds).toEqual([1, 'abc']);
    multiplexer.handleMessage(createResponse(1, 'x'));
    expect(multiplexer.pendingIds).toEqual(['abc']);
    multiplexer.handleMessage(createResponse('abc', 'y'));
    await p1;
  });

  it('surfaces protocol errors (result XOR error)', async () => {
    const multiplexer = new RequestMultiplexer();
    const promise = multiplexer.register(createRequest(5, 'tools/call'));
    multiplexer.handleMessage(createErrorResponse(5, -32602, 'invalid params'));
    await expect(promise).rejects.toBeInstanceOf(JsonRpcRemoteError);
    await expect(promise).rejects.toMatchObject({ code: -32602, name: 'JsonRpcRemoteError' });
  });

  it('rejects with TimeoutError when the deadline expires', async () => {
    const multiplexer = new RequestMultiplexer();
    const promise = multiplexer.register(createRequest(11, 'never/answers'), 30);
    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await expect(promise).rejects.toMatchObject({ kind: 'request' });
    expect(multiplexer.pendingCount).toBe(0);
  });

  it('does not complete before the deadline', async () => {
    const multiplexer = new RequestMultiplexer();
    let settled = false;
    const promise = multiplexer.register(createRequest(12, 'slow'), 200).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await wait(50);
    expect(settled).toBe(false);
    multiplexer.handleMessage(createResponse(12, 'done'));
    await promise;
    expect(settled).toBe(true);
  });

  it('fails all pending requests when the transport dies', async () => {
    const multiplexer = new RequestMultiplexer();
    const p1 = multiplexer.register(createRequest(1, 'ping'));
    const p2 = multiplexer.register(createRequest(2, 'ping'));
    multiplexer.failAll(new Error('transport closed'));
    await expect(p1).rejects.toThrow('transport closed');
    await expect(p2).rejects.toThrow('transport closed');
    expect(multiplexer.pendingCount).toBe(0);
  });

  it('passes notifications through without consuming them', () => {
    const multiplexer = new RequestMultiplexer();
    expect(() => multiplexer.handleMessage(createNotification('notifications/initialized'))).not.toThrow();
    expect(multiplexer.pendingCount).toBe(0);
  });
});