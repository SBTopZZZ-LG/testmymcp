import { describe, expect, it } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSession } from '../../src/sessions/index.js';
import type { SessionTarget } from '../../src/sessions/index.js';

const envFixture = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/env-server.js');

async function toolResultText(target: SessionTarget, args: Record<string, unknown> = {}): Promise<unknown> {
  const { adapter } = buildSession(target, { timeoutMs: 15_000, showSecrets: true });
  try {
    await adapter.connect();
    await adapter.initialize();
    const call = await adapter.request<{ content: Array<{ type: string; text?: string }> }>('tools/call', {
      name: 'read_env',
      arguments: args,
    });
    return call.content?.[0]?.text;
  } finally {
    try {
      await adapter.disconnect();
    } catch {
      // best-effort teardown
    }
  }
}

describe('stdio session env support', () => {
  it('passes env vars to the child so a server can read them', async () => {
    const target: SessionTarget = {
      transport: 'stdio',
      command: `node "${envFixture}"`,
      env: { FIXTURE_VALUE: 'hello-from-env' },
    };
    expect(await toolResultText(target)).toBe('hello-from-env');
  });

  it('yields empty output without the env var (proving it is not inherited from the test env)', async () => {
    const target: SessionTarget = { transport: 'stdio', command: `node "${envFixture}"` };
    expect(await toolResultText(target)).toBe('');
  });
});
