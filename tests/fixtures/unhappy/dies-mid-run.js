// Unhappy fixture: serves normally for a few requests, then dies (exit 0) part
// way through a session. The client must degrade gracefully and never hang.
import { onLine, makeResult } from '../helpers/stdio.js';

let count = 0;
function handle(message) {
  if (message.id === undefined) return null;
  count += 1;
  if (count >= 4) {
    process.exit(0);
    return null;
  }
  if (message.method === 'initialize') {
    return makeResult(message, { protocolVersion: '2025-11-25', serverInfo: { name: 'dies-mid-run', version: '1.0.0' }, capabilities: { tools: {} } });
  }
  if (message.method === 'tools/list') return makeResult(message, { tools: [{ name: 'sum', description: 'sum', inputSchema: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } }, required: ['a', 'b'] } }] });
  return makeResult(message, {});
}

onLine(handle);
