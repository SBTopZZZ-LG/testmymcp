// Unhappy fixture: returns valid JSON but a malformed JSON-RPC response —
// both `result` and `error` present on the same message (contradictory).
import { onLine } from '../helpers/stdio.js';

function handle(message) {
  if (message.id === undefined) return null;
  return { jsonrpc: '2.0', id: message.id, result: { ok: true }, error: { code: -32000, message: 'contradictory response' } };
}

onLine(handle);
