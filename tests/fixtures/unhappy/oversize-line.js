// Unhappy fixture: emits a single oversize line (well over the 1 MB line-size
// cap used by the e2e scenario) in response to the first non-initialize
// request, then serves normally. The line is emitted deterministically after
// initialize has completed so the client can never race a pending initialize.
// The client must surface the oversize framing and continue without crashing.
// Bounded lifetime.
import { makeResult, onLine } from '../helpers/stdio.js';

setTimeout(() => process.exit(0), 8000);

let flagged = false;

function handle(message) {
  if (message.id === undefined) return null;
  if (message.method === 'initialize') {
    return makeResult(message, {
      protocolVersion: '2025-11-25',
      serverInfo: { name: 'oversize', version: '1.0.0' },
      capabilities: { tools: {} },
    });
  }
  if (!flagged) {
    flagged = true;
    process.stdout.write(`${'x'.repeat(2 * 1024 * 1024)}\n`);
  }
  return makeResult(message, {});
}

onLine(handle);
