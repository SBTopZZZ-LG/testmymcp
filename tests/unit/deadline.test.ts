import { describe, expect, it } from 'vitest';

import { TimeoutError, delay, withDeadline } from '../../src/core/timeouts/deadline.js';

describe('withDeadline', () => {
  it('resolves when the task completes in time', async () => {
    const result = await withDeadline({ kind: 'tool', ms: 1000 }, async () => 'done');
    expect(result).toBe('done');
  });

  it('rejects with a TimeoutError carrying kind and timeout when the task is too slow', async () => {
    const promise = withDeadline({ kind: 'initialize', ms: 25 }, async () => {
      await delay(500);
      return 'too late';
    });
    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await expect(promise).rejects.toMatchObject({ kind: 'initialize', timeoutMs: 25 });
  });

  it('propagates task errors', async () => {
    await expect(
      withDeadline({ kind: 'request', ms: 1000 }, async () => {
        throw new Error('task exploded');
      }),
    ).rejects.toThrow('task exploded');
  });

  it('signals abort when the deadline fires', async () => {
    let aborted = false;
    const result = withDeadline({ kind: 'connect', ms: 25 }, async (signal) => {
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      });
    });
    await expect(result).rejects.toBeInstanceOf(TimeoutError);
    await delay(10);
    expect(aborted).toBe(true);
  });

  it('supports a custom message', async () => {
    const promise = withDeadline({ kind: 'test', ms: 15, message: 'server refused to exit' }, () =>
      delay(500),
    );
    await expect(promise).rejects.toThrow('server refused to exit');
  });
});
