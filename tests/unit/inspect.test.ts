import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderTimeline, runInspect } from '../../src/cli/inspect.js';
import type { TraceMessage } from '../../src/core/types/trace.js';

describe('inspect', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('renders a chronological timeline', () => {
    const messages: TraceMessage[] = [
      { id: 'a', timestamp: 1000, direction: 'out', kind: 'request', method: 'initialize', requestId: 1 },
      { id: 'b', timestamp: 1005, direction: 'in', kind: 'response', requestId: 1, latencyMs: 5 },
      { id: 'c', timestamp: 1002, direction: 'out', kind: 'request', method: 'tools/list', requestId: 2 },
    ];
    const timeline = renderTimeline(messages).split('\n');
    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toContain('initialize');
    expect(timeline[1]).toContain('tools/list');
    expect(timeline[2]).toContain('response');
  });

  it('loads and renders a saved trace file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'testmymcp-'));
    const file = join(dir, 'trace.json');
    const store = {
      kind: 'mcp-trace',
      version: 1,
      count: 2,
      messages: [
        { id: 'a', timestamp: 100, direction: 'out', kind: 'request', method: 'ping', requestId: 1 },
        { id: 'b', timestamp: 200, direction: 'in', kind: 'response', requestId: 1 },
      ],
    };
    await writeFile(file, JSON.stringify(store));

    const exitCode = await runInspect(file);
    expect(exitCode).toBe(0);
    expect(logSpy.mock.calls.some((call: unknown[]) => String(call[0]).includes('ping'))).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects files that are not traces', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'testmymcp-'));
    const file = join(dir, 'trace.json');
    await writeFile(file, JSON.stringify({ foo: 1 }));

    const exitCode = await runInspect(file);
    expect(exitCode).toBe(1);
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects unreadable files', async () => {
    const exitCode = await runInspect(join(tmpdir(), 'does-not-exist.json'));
    expect(exitCode).toBe(1);
  });
});