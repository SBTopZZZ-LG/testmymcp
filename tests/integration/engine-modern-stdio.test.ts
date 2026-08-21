import { describe, expect, it } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { protocolAdapterFactory } from '../../src/core/protocol/factory.js';
import { StdioTransport } from '../../src/transports/stdio/index.js';

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/modern-stdio-server.js');

describe('modern engine integration over stdio', () => {
  it('discovers and calls a tool on a modern stateless stdio server', async () => {
    const transport = new StdioTransport({ command: `node ${fixturePath}` });
    const adapter = protocolAdapterFactory.create('modern', { transport, initTimeoutMs: 5000, requestTimeoutMs: 8000 });
    transport.observer = { onMessage: (message) => adapter.mux.handleMessage(message) };

    try {
      await adapter.connect();
      const session = await adapter.initialize();
      expect(session.protocolVersion).toBe('2026-07-28');

      const discovered = await adapter.discover();
      expect(discovered.supportedVersions).toContain('2026-07-28');

      const sum = (await adapter.request('tools/call', { name: 'sum', arguments: { a: 2, b: 3 } }, 8000)) as Record<string, unknown>;
      expect(sum.resultType).toBe('complete');
      const content = sum.content as Array<Record<string, unknown>>;
      expect(content[0]?.text).toBe('5');
    } finally {
      await adapter.disconnect();
    }
  });
});
