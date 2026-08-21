import type { JsonRpcId } from './messages.js';

export type IdStyle = 'number' | 'string' | 'mixed' | 'large';

const LARGE_IDS: readonly JsonRpcId[] = ['131621703842267136', 9007199254740991, 0, '-1'];

export function createIdGenerator(style: IdStyle = 'mixed'): () => JsonRpcId {
  let numeric = 0;
  let stringSeq = 0;
  let largeIndex = 0;

  return () => {
    switch (style) {
      case 'number':
        numeric += 1;
        return numeric;
      case 'string':
        stringSeq += 1;
        return `req-${stringSeq}`;
      case 'large': {
        const id = LARGE_IDS[largeIndex % LARGE_IDS.length] ?? 0;
        largeIndex += 1;
        return id;
      }
      case 'mixed':
        numeric += 1;
        if (numeric === 1) return 1;
        if (numeric === 2) return 2;
        if (numeric === 3) return 3;
        if (numeric === 4) return 'abc';
        return `tool-call-${numeric - 4}`;
    }
  };
}
