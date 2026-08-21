import { readFile } from 'node:fs/promises';

import type { TraceMessage, TraceStoreJson } from '../core/types/trace.js';

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(11, 23);
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms.toFixed(2)}ms`;
}

export function renderTimeline(messages: readonly TraceMessage[]): string {
  const ordered = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  const lines: string[] = [];
  for (const message of ordered) {
    const arrow = message.direction === 'out' ? '→' : '←';
    const id = message.requestId !== undefined ? ` #${String(message.requestId)}` : '';
    const latency = message.latencyMs !== undefined ? `  ${formatDuration(message.latencyMs)}` : '';
    lines.push(
      `[${formatTimestamp(message.timestamp)}] ${arrow} ${message.kind.padEnd(13)} ${message.method ?? ''}${id}${latency}`,
    );
  }
  return lines.join('\n');
}

export async function runInspect(filePath: string): Promise<number> {
  let parsed: unknown;
  try {
    const content = await readFile(filePath, 'utf8');
    parsed = JSON.parse(content);
  } catch (error) {
    console.error(
      `inspect: cannot read trace file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  const file = parsed as Partial<TraceStoreJson>;
  if (file?.kind !== 'mcp-trace' || !Array.isArray(file.messages)) {
    console.error(
      'inspect: not a testmymcp trace file (expected { "kind": "mcp-trace", "messages": [...] })',
    );
    return 1;
  }

  const messages = [...file.messages].sort((a, b) => a.timestamp - b.timestamp);
  console.log(renderTimeline(messages));
  const expectedCount = file.count ?? file.messages.length;
  if (expectedCount !== messages.length) {
    console.warn(`inspect: header says ${expectedCount} messages, found ${messages.length}`);
  }
  return 0;
}
