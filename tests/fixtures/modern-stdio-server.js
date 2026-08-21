import readline from 'node:readline';

// Minimal modern (2026-07-28, stateless) MCP server over stdio (NDJSON).
// Responds to `server/discover` instead of `initialize` and to a small set of
// methods, mirroring the behavior of tests/fixtures/modern-server.js but over
// stdin/stdout for the modern stdio integration test.

const SUPPORTED = ['2026-07-28'];

const tools = [
  {
    name: 'sum',
    description: 'sum two integers and return the result',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'integer' }, b: { type: 'integer' } },
      required: ['a', 'b'],
      additionalProperties: false,
    },
  },
];

function readMeta(message) {
  const params = message.params && typeof message.params === 'object' ? message.params : undefined;
  const meta = params?._meta;
  return meta && typeof meta === 'object' ? meta : undefined;
}

function checkProtocol(message) {
  const meta = readMeta(message);
  const version = meta ? meta['io.modelcontextprotocol/protocolVersion'] : undefined;
  if (typeof version !== 'string' || !SUPPORTED.includes(version)) {
    return { jsonrpc: '2.0', id: message.id, error: { code: -32022, message: 'Unsupported protocol version', data: { supported: SUPPORTED } } };
  }
  if (message.id !== undefined && !meta) {
    return { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'missing _meta' } };
  }
  return null;
}

function handleMessage(message) {
  if (message.id === undefined) return null;
  const protoError = checkProtocol(message);
  if (protoError) return protoError;

  switch (message.method) {
    case 'server/discover':
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          resultType: 'complete',
          supportedVersions: SUPPORTED,
          capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} },
          _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'modern-stdio-fake-server', version: '1.0.0' } },
          instructions: 'Modern stateless stdio fixture',
          ttlMs: 60000,
          cacheScope: 'public',
        },
      };

    case 'tools/list':
      return { jsonrpc: '2.0', id: message.id, result: { resultType: 'complete', tools, ttlMs: 60000, cacheScope: 'public' } };

    case 'tools/call': {
      const name = message.params?.name;
      const callArgs = message.params?.arguments;
      if (name === 'sum') {
        if (!callArgs || typeof callArgs.a !== 'number' || typeof callArgs.b !== 'number') {
          return { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'a and b must be integers' } };
        }
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: { resultType: 'complete', content: [{ type: 'text', text: String(callArgs.a + callArgs.b) }] },
        };
      }
      return { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: `unknown tool: ${String(name ?? '?')}` } };
    }

    default:
      return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `method not found: ${String(message.method)}` } };
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed === '') return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`);
    return;
  }
  const response = handleMessage(message);
  if (response !== null) {
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
