// Unhappy fixture: emits a single oversize line (well over the 1 MB default
// max line size) on startup, then serves normally. The client must surface the
// oversize framing and continue without crashing. Bounded lifetime.
import { onLine, makeResult } from '../helpers/stdio.js';

process.stdout.write(`${'x'.repeat(2 * 1024 * 1024)}\n`);
setTimeout(() => process.exit(0), 8000);

function handle(message) {
  if (message.id === undefined) return null;
  if (message.method === 'initialize') {
    return makeResult(message, { protocolVersion: '2025-11-25', serverInfo: { name: 'oversize', version: '1.0.0' }, capabilities: { tools: {} } });
  }
  return makeResult(message, {});
}

onLine(handle);
