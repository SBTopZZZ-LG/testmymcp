import type { ProtocolAdapter } from '../core/protocol/adapter.js';

function nextCursorOf(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) return undefined;
  const r = result as Record<string, unknown>;
  const cursor = r['nextCursor'] ?? (typeof r['result'] === 'object' && r['result'] !== null ? (r['result'] as Record<string, unknown>)['nextCursor'] : undefined);
  return typeof cursor === 'string' && cursor.length > 0 ? cursor : undefined;
}

function itemsOf(result: unknown, key: 'tools' | 'resources'): unknown[] {
  if (typeof result !== 'object' || result === null) return [];
  const r = result as Record<string, unknown>;
  const arr = r[key] ?? (typeof r['result'] === 'object' && r['result'] !== null ? (r['result'] as Record<string, unknown>)[key] : undefined);
  return Array.isArray(arr) ? (arr as unknown[]) : [];
}

export interface PageFollow {
  method: string;
  itemKey: 'tools' | 'resources';
  initialParams?: object;
}

/**
 * Follow a cursor-based list result to exhaustion. Returns every item seen
 * across all pages and the number of pages fetched. Used to verify that a
 * server paginates correctly and that a client can reconstruct the full set.
 */
export async function followListPages(
  adapter: ProtocolAdapter,
  follow: PageFollow,
  firstResult: unknown,
  timeoutMs: number,
  maxPages: number,
): Promise<{ items: unknown[]; pages: number; truncated: boolean }> {
  const items = [...itemsOf(firstResult, follow.itemKey)];
  let cursor = nextCursorOf(firstResult);
  let pages = 1;
  let truncated = false;
  while (cursor !== undefined && pages < maxPages) {
    const result = await adapter.request(follow.method, { ...(follow.initialParams ?? {}), cursor }, timeoutMs);
    items.push(...itemsOf(result, follow.itemKey));
    const next = nextCursorOf(result);
    pages += 1;
    if (next === undefined) {
      cursor = undefined;
    } else {
      cursor = next;
    }
    if (pages >= maxPages) truncated = true;
  }
  return { items, pages, truncated };
}
