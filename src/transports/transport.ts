import type { TransportType } from '../core/types/protocol.js';

export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface OversizeInfo {
  bytes: number;
  line: string;
}

export interface TransportObserver {
  onMessage?: (message: unknown) => void;
  onGarbage?: (line: string) => void;
  onStderr?: (line: string) => void;
  onExit?: (exit: ExitInfo) => void;
  onError?: (error: Error) => void;
  onOversize?: (info: OversizeInfo) => void;
}

export interface Transport {
  readonly kind: TransportType;
  observer?: TransportObserver;
  readonly stderrLines: readonly string[];
  readonly exited: ExitInfo | null;
  start(): Promise<void>;
  send(message: unknown): Promise<void>;
  stop(): Promise<void>;
  isOpen(): boolean;
}

/**
 * A long-lived server-to-client notification stream, for `subscriptions/listen`
 * (modern). The stream stays open until cancelled; each parsed JSON-RPC message
 * is forwarded to `observer.onMessage` and also handed to `onFrame`. It resolves
 * when the stream ends (server close, transport stop, or error).
 */
export interface ListenStream {
  /** The JSON-RPC id of the originating `subscriptions/listen` request. */
  readonly id: unknown;
  /** JSON-RPC messages received so far on the stream (acked/change notifications). */
  readonly events: unknown[];
  /** Register a handler for each JSON-RPC message received on the stream. */
  onFrame(handler: (message: unknown) => void): void;
  /** Resolves when the stream ends (graceful server close or transport stop). */
  readonly closed: Promise<void>;
  /** Cancel the subscription (closes the HTTP response stream). */
  cancel(): Promise<void>;
}
