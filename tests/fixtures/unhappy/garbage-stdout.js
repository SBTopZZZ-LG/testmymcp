// Unhappy fixture: emits garbage (non-JSON) on stdout on startup and before
// every response, while otherwise serving normally. The client must flag the
// framing violation yet continue (not hang).
import { makeResult, onLine } from '../helpers/stdio.js';

const INIT = {
  protocolVersion: '2025-11-25',
  serverInfo: { name: 'garbage', version: '1.0.0' },
  capabilities: { tools: {} },
};

function handle(message) {
  process.stdout.write('garbage {{{:: this is not json\n');
  if (message.id === undefined) return null;
  if (message.method === 'initialize') return makeResult(message, INIT);
  if (message.method === 'tools/list') return makeResult(message, { tools: [] });
  if (message.method === 'ping') return makeResult(message, {});
  return makeResult(message, {});
}

process.stdout.write('banner: NOT-JSON {{{::\n');
onLine(handle);
