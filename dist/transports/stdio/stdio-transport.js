import { spawn } from 'node:child_process';
import { NdjsonReader, encodeNdjson } from '../../core/jsonrpc/codec.js';
import { parseServerCommand } from '../command.js';
const MAX_STDERR_LINES = 1000;
export class StdioTransport {
    kind = 'stdio';
    observer;
    options;
    child;
    reader;
    lastExit = null;
    stderrLog = [];
    stderrPartial = '';
    stopping = false;
    constructor(options) {
        this.options = options;
    }
    get stderrLines() {
        return this.stderrLog;
    }
    get exited() {
        return this.lastExit;
    }
    isOpen() {
        const child = this.child;
        return (child !== undefined &&
            child.exitCode === null &&
            !child.killed &&
            child.stdin !== null &&
            !child.stdin.destroyed &&
            !child.stdin.writableEnded);
    }
    async start() {
        if (this.child !== undefined)
            throw new Error('stdio transport already started');
        const spec = parseServerCommand(this.options.command);
        const child = spawn(spec.command, spec.args, {
            shell: spec.shell,
            detached: process.platform !== 'win32',
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...this.options.env },
        });
        this.child = child;
        // The server may exit while we still hold its stdin (e.g. it crashed, or
        // teardown raced with a write). A write into that broken pipe emits an
        // 'error' (EPIPE) on the stream; without a listener it surfaces as an
        // uncaught exception. The write-side promise/callback is rejected and
        // handled by callers, so swallow the event here.
        child.stdin?.on('error', () => {
            // ignore expected broken-pipe errors
        });
        this.reader = new NdjsonReader({
            maxBytes: this.options.maxLineBytes,
            onLine: (line) => this.checkLineSize(line),
        });
        child.stdout?.on('data', (chunk) => this.handleStdout(chunk));
        child.stderr?.on('data', (chunk) => this.handleStderr(chunk));
        child.on('exit', (code, signal) => {
            this.lastExit = { code, signal };
            this.observer?.onExit?.(this.lastExit);
        });
        child.on('error', (error) => this.observer?.onError?.(error));
        await new Promise((resolve, reject) => {
            child.once('spawn', () => resolve());
            child.once('error', (error) => reject(error));
        });
    }
    async send(message) {
        const child = this.child;
        if (child === undefined)
            throw new Error('transport not started');
        const stdin = child.stdin;
        if (stdin === null || stdin.destroyed || stdin.writableEnded) {
            throw new Error('stdio transport stdin is not writable');
        }
        await new Promise((resolve, reject) => {
            stdin.write(encodeNdjson(message), (error) => {
                if (error === null || error === undefined)
                    resolve();
                else
                    reject(error);
            });
        });
    }
    async stop() {
        const child = this.child;
        if (child === undefined || this.stopping)
            return;
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
    terminateTree(signal) {
        const child = this.child;
        if (child === undefined || child.pid === undefined)
            return;
        if (process.platform === 'win32') {
            try {
                spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
            }
            catch {
                child.kill();
            }
            return;
        }
        try {
            process.kill(-child.pid, signal);
        }
        catch {
            try {
                child.kill(signal);
            }
            catch {
                // ignore
            }
        }
    }
    waitForExit(ms) {
        const child = this.child;
        if (child === undefined || this.lastExit !== null)
            return Promise.resolve();
        return new Promise((resolve) => {
            const timer = setTimeout(resolve, ms);
            child.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }
    handleStdout(chunk) {
        const reader = this.reader;
        if (reader === undefined)
            return;
        for (const event of reader.push(chunk)) {
            if (event.kind === 'message')
                this.observer?.onMessage?.(event.message);
            else if (event.kind === 'garbage')
                this.observer?.onGarbage?.(event.line);
            else {
                const info = { bytes: event.bytes, line: '<line truncated>' };
                this.observer?.onOversize?.(info);
            }
        }
    }
    handleStderr(chunk) {
        this.stderrPartial += chunk.toString('utf8');
        const lines = this.stderrPartial.split('\n');
        this.stderrPartial = lines.pop() ?? '';
        for (const line of lines) {
            this.emitStderr(line);
        }
    }
    emitStderr(line) {
        if (this.stderrLog.length >= MAX_STDERR_LINES)
            return;
        this.stderrLog.push(line);
        this.observer?.onStderr?.(line);
    }
    checkLineSize(line) {
        const max = this.options.maxLineBytes;
        if (max === undefined)
            return;
        const bytes = Buffer.byteLength(line, 'utf8');
        if (bytes > max) {
            const info = { bytes, line };
            this.observer?.onOversize?.(info);
        }
    }
}
//# sourceMappingURL=stdio-transport.js.map