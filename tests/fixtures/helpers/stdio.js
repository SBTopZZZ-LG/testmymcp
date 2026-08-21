// Shared helpers for stdio (NDJSON) MCP fixture servers.
import readline from 'node:readline';

export function argsOf() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(`--${name}`);
  const value = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : dflt;
  };
  return { args, flag, value };
}

export function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

export function makeResult(message, result) {
  return { jsonrpc: '2.0', id: message.id, result };
}

export function makeError(message, code, text) {
  return { jsonrpc: '2.0', id: message.id, error: { code, message: text } };
}

/**
 * Start a stdio MCP fixture. `handler(message)` receives each parsed JSON-RPC
 * request; it may call send/makeResult/makeError. Returning null means the
 * message was a notification (no response). The loop closes (exit 0) when stdin
 * closes, so the transport can terminate it gracefully.
 */
export function onLine(handler) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed === '') return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }
    const payload = handler(message);
    if (payload !== null && payload !== undefined) send(payload);
  });
  rl.on('close', () => process.exit(0));
  return rl;
}

export function shutDownOnSignal() {
  const done = () => process.exit(0);
  process.on('SIGTERM', done);
  process.on('SIGINT', done);
}
