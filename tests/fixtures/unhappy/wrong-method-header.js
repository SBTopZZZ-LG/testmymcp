// Unhappy fixture (legacy HTTP): reports a wrong `Mcp-Method` header on the
// initialize response, so header-routing validation flags a mismatch.
import { argsOf, listen, sessionHandler, makeResult } from '../helpers/http.js';

listen({
  port: argsOf().port,
  handler: sessionHandler(
    (message) => {
      if (message.method === 'initialize') {
        return makeResult(message, { protocolVersion: '2025-11-25', serverInfo: { name: 'wrong-header', version: '1.0.0' }, capabilities: { tools: {} } });
      }
      if (message.method === 'tools/list') return makeResult(message, { tools: [] });
      return null;
    },
    { name: 'wrongheader', methodOverride: (m) => (m === 'initialize' ? 'initialize-WRONG' : m) },
  ),
});
