import type { JsonRpcId } from './messages.js';
export type IdStyle = 'number' | 'string' | 'mixed' | 'large';
export declare function createIdGenerator(style?: IdStyle): () => JsonRpcId;
