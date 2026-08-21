import type { ProtocolAdapter } from '../core/protocol/adapter.js';
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
export declare function followListPages(adapter: ProtocolAdapter, follow: PageFollow, firstResult: unknown, timeoutMs: number, maxPages: number): Promise<{
    items: unknown[];
    pages: number;
    truncated: boolean;
}>;
