// Reproduces a real-world failure mode: a tools/call result whose JSON-RPC
// line is far larger than the historical 1 MB default line cap (like an MCP
// server returning ~56k symbols in one response, ~6 MB after JSON escaping).
// With a small line cap the client must fail the call fast with a
// transport-level line-size error (never hang); with the default cap the
// call must succeed. Bounded lifetime.
import { makeResult, onLine } from '../helpers/stdio.js';

const SYMBOL_COUNT = 200000;

function handle(message) {
  if (message.id === undefined) return null;
  switch (message.method) {
    case 'initialize':
      return makeResult(message, {
        protocolVersion: '2025-11-25',
        serverInfo: { name: 'big-tool-result', version: '1.0.0' },
        capabilities: { tools: {} },
      });
    case 'tools/list':
      return makeResult(message, {
        tools: [
          {
            name: 'get_symbols',
            description: 'read the symbol table',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          },
        ],
      });
    case 'tools/call': {
      const params = message.params ?? {};
      if (params.name !== 'get_symbols') {
        return makeResult(message, { content: [], isError: true });
      }
      const symbols = Array.from({ length: SYMBOL_COUNT }, (_, i) => ({
        addr: `0x${i.toString(16)}`,
        sym: `sym_${i}`,
      }));
      // One line, several MiB when serialized — trips caps below ~6.5 MB.
      return makeResult(message, {
        content: [{ type: 'text', text: JSON.stringify(symbols) }],
      });
    }
    default:
      return makeResult(message, {});
  }
}

onLine(handle);
setTimeout(() => process.exit(0), 8000);
