// Unhappy fixture (legacy HTTP): advertises a wrong/unknown protocol version in
// the `MCP-Protocol-Version` response header.
import { argsOf, listen, sessionHandler, makeResult } from '../helpers/http.js';

listen({
  port: argsOf().port,
  handler: sessionHandler(
    (message) => {
      if (message.method === 'initialize') {
        return makeResult(message, { protocolVersion: '2025-11-25', serverInfo: { name: 'bad-version', version: '1.0.0' }, capabilities: { tools: {} } });
      }
      if (message.method === 'tools/list') return makeResult(message, { tools: [] });
      return null;
    },
    { name: 'badversion', headerVersion: '2000-01-01' },
  ),
});
