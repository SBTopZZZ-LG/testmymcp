import type { TraceMessage } from '../core/types/trace.js';
export declare function renderTimeline(messages: readonly TraceMessage[]): string;
export declare function runInspect(filePath: string): Promise<number>;
