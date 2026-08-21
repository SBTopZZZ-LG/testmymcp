export type TimeoutKind = 'connect' | 'initialize' | 'request' | 'tool' | 'test';

export class TimeoutError extends Error {
  readonly kind: TimeoutKind;
  readonly timeoutMs: number;

  constructor(kind: TimeoutKind, timeoutMs: number, message?: string) {
    super(message ?? `${kind} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.kind = kind;
    this.timeoutMs = timeoutMs;
  }
}

export interface DeadlineOptions {
  kind: TimeoutKind;
  ms: number;
  message?: string;
}

export function withDeadline<T>(
  options: DeadlineOptions,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(options.kind, options.ms, options.message));
    }, options.ms);

    Promise.resolve()
      .then(() => task(controller.signal))
      .then(
        (value) => {
          if (timer !== undefined) clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (timer !== undefined) clearTimeout(timer);
          reject(error);
        },
      );
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}