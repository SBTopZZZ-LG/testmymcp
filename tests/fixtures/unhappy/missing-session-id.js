// Unhappy fixture (legacy HTTP): never returns `Mcp-Session-Id`, so the client
// cannot establish a sessioned streamable-http connection.
import { argsOf, listen, sessionHandler, makeResult } from '../helpers/http.js';

listen({
  port: argsOf().port,
  handler: sessionHandler(
    (message) => {
      if (message.method === 'initialize') {
        return makeResult(message, { protocolVersion: '2025-11-25', serverInfo: { name: 'nosession', version: '1.0.0' }, capabilities: { tools: {} } });
      }
      if (message.method === 'tools/list') return makeResult(message, { tools: [] });
      return null;
    },
    { name: 'nosession', withSessionId: false },
  ),
});
