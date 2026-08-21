// Unhappy fixture (legacy HTTP): a valid tool that always returns an application
// error (isError: true) — the MCP layer is fine, the tool itself fails.
import { argsOf, listen, sessionHandler, makeResult } from '../helpers/http.js';

listen({
  port: argsOf().port,
  handler: sessionHandler(
    (message) => {
      if (message.method === 'initialize') {
        return makeResult(message, { protocolVersion: '2025-11-25', serverInfo: { name: 'app-error', version: '1.0.0' }, capabilities: { tools: {} } });
      }
      if (message.method === 'tools/list') {
        return makeResult(message, {
          tools: [{ name: 'fail_tool', description: 'always fails', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }],
        });
      }
      if (message.method === 'tools/call') {
        return makeResult(message, { content: [{ type: 'text', text: 'boom' }], isError: true });
      }
      return null;
    },
    { name: 'apperror' },
  ),
});
