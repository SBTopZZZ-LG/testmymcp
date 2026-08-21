import { spawn, type ChildProcess } from 'node:child_process';
import { encodeNdjson, NdjsonReader } from '../../core/jsonrpc/codec.js';
import type { Transport, TransportObserver, ExitInfo, OversizeInfo } from '../transport.js';
import { parseServerCommand } from '../command.js';

const MAX_STDERR_LINES = 1000;

export interface StdioTransportOptions {
  command: string;
  maxLineBytes?: number;
  shutdownTimeoutMs?: number;
  /** Env vars merged over the current process environment for the child. */
  env?: Record<string, string>;
}

export class StdioTransport implements Transport {
  readonly kind = 'stdio' as const;
  observer?: TransportObserver;
  private readonly options: StdioTransportOptions;
  private child: ChildProcess | undefined;
  private reader: NdjsonReader | undefined;
  private lastExit: ExitInfo | null = null;
  private stderrLog: string[] = [];
  private stderrPartial = '';
  private stopping = false;

  constructor(options: StdioTransportOptions) {
    this.options = options;
  }

  get stderrLines(): readonly string[] {
    return this.stderrLog;
  }

  get exited(): ExitInfo | null {
    return this.lastExit;
  }

  isOpen(): boolean {
    const child = this.child;
    return (
      child !== undefined &&
      child.exitCode === null &&
      !child.killed &&
      child.stdin !== null &&
      !child.stdin.destroyed &&
      !child.stdin.writableEnded
    );
  }

  async start(): Promise<void> {
    if (this.child !== undefined) throw new Error('stdio transport already started');
    const spec = parseServerCommand(this.options.command);
    const child = spawn(spec.command, spec.args, {
      shell: spec.shell,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.options.env },
    });
    this.child = child;
    this.reader = new NdjsonReader({
      maxBytes: this.options.maxLineBytes,
      onLine: (line) => this.checkLineSize(line),
    });
    child.stdout?.on('data', (chunk: Buffer) => this.handleStdout(chunk));
    child.stderr?.on('data', (chunk: Buffer) => this.handleStderr(chunk));
    child.on('exit', (code, signal) => {
      this.lastExit = { code, signal };
      this.observer?.onExit?.(this.lastExit);
    });
    child.on('error', (error) => this.observer?.onError?.(error));

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', (error) => reject(error));
    });
  }

  async send(message: unknown): Promise<void> {
    const child = this.child;
    if (child === undefined) throw new Error('transport not started');
    const stdin = child.stdin;
    if (stdin === null || stdin.destroyed || stdin.writableEnded) {
      throw new Error('stdio transport stdin is not writable');
    }
    await new Promise<void>((resolve, reject) => {
      stdin.write(encodeNdjson(message), (error) => {
        if (error === null || error === undefined) resolve();
        else reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (child === undefined || this.stopping) return;
    this.stopping = true;
    const grace = this.options.shutdownTimeoutMs ?? 2000;

    if (child.stdin !== null && !child.stdin.destroyed && !child.stdin.writableEnded) {
      child.stdin.end();
    }
    await this.waitForExit(grace);
    if (this.lastExit === null) {
      this.terminateTree('SIGTERM');
      await this.waitForExit(500);
    }
    if (this.lastExit === null) {
      this.terminateTree('SIGKILL');
      await this.waitForExit(500);
    }
    if (this.stderrPartial !== '') {
      this.emitStderr(this.stderrPartial);
      this.stderrPartial = '';
    }
    this.child = undefined;
  }

  private terminateTree(signal: NodeJS.Signals): void {
    const child = this.child;
    if (child === undefined || child.pid === undefined) return;
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        child.kill();
      }
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // ignore
      }
    }
  }

  private waitForExit(ms: number): Promise<void> {
    const child = this.child;
    if (child === undefined || this.lastExit !== null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private handleStdout(chunk: Buffer): void {
    const reader = this.reader;
    if (reader === undefined) return;
    for (const event of reader.push(chunk)) {
      if (event.kind === 'message') this.observer?.onMessage?.(event.message);
      else if (event.kind === 'garbage') this.observer?.onGarbage?.(event.line);
      else {
        const info: OversizeInfo = { bytes: event.bytes, line: '<line truncated>' };
        this.observer?.onOversize?.(info);
      }
    }
  }

  private handleStderr(chunk: Buffer): void {
    this.stderrPartial += chunk.toString('utf8');
    const lines = this.stderrPartial.split('\n');
    this.stderrPartial = lines.pop() ?? '';
    for (const line of lines) {
      this.emitStderr(line);
    }
  }

  private emitStderr(line: string): void {
    if (this.stderrLog.length >= MAX_STDERR_LINES) return;
    this.stderrLog.push(line);
    this.observer?.onStderr?.(line);
  }

  private checkLineSize(line: string): void {
    const max = this.options.maxLineBytes;
    if (max === undefined) return;
    const bytes = Buffer.byteLength(line, 'utf8');
    if (bytes > max) {
      const info: OversizeInfo = { bytes, line };
      this.observer?.onOversize?.(info);
    }
  }
}