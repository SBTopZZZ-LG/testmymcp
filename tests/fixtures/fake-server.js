import readline from 'node:readline';

const args = process.argv.slice(2);
const banner = args.includes('--banner');
const crash = args.includes('--crash');
const hang = args.includes('--hang');
const slowInit = args.includes('--slow-init');
const acceptAnyVersion = args.includes('--accept-any-version');
const paginate = args.includes('--paginate');
const logOnCall = args.includes('--log-on-call');

const SUPPORTED_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
const SERVER_VERSION = '2025-11-25';

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
  {
    name: 'delete_file',
    description: 'Delete a file from the configured working directory',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
];

const resources = [
  {
    uri: 'file:///tmp/hello.txt',
    name: 'hello',
    description: 'a sample resource',
    mimeType: 'text/plain',
  },
];

const resourceTemplates = [{ uriTemplate: 'file:///{path}', name: 'generic file' }];

const prompts = [
  { name: 'greeting', description: 'greet someone', arguments: [{ name: 'who', required: true }] },
];

let initialized = false;

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function resultFor(request, result) {
  send({ jsonrpc: '2.0', id: request.id, result });
}

function errorFor(request, code, message) {
  send({ jsonrpc: '2.0', id: request.id, error: { code, message } });
}

async function handle(message) {
  if (hang) return;

  if (message.id === undefined) {
    if (message.method === 'notifications/initialized') initialized = true;
    return;
  }

  switch (message.method) {
    case 'initialize': {
      if (slowInit) await new Promise((resolve) => setTimeout(resolve, 400));
      const requested = message.params?.protocolVersion;
      if (
        !acceptAnyVersion &&
        typeof requested === 'string' &&
        !SUPPORTED_VERSIONS.has(requested)
      ) {
        return errorFor(message, -32602, `unsupported protocol version: ${requested}`);
      }
      return resultFor(message, {
        protocolVersion: SERVER_VERSION,
        serverInfo: { name: 'fake-mcp-server', version: '1.0.0' },
        capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
      });
    }

    case 'tools/list':
      if (!initialized) return errorFor(message, -32001, 'server is not initialized');
      if (paginate) {
        const page = Number(message.params?.cursor ?? '0') || 0;
        const pageSize = 1;
        const slice = tools.slice(page * pageSize, page * pageSize + pageSize);
        const hasMore = (page + 1) * pageSize < tools.length;
        return resultFor(message, {
          tools: slice,
          nextCursor: hasMore ? String(page + 1) : undefined,
        });
      }
      return resultFor(message, { tools });

    case 'tools/call': {
      if (!initialized) return errorFor(message, -32001, 'server is not initialized');
      const name = message.params?.name;
      const callArgs = message.params?.arguments;
      if (name === 'sum') {
        if (!callArgs || typeof callArgs.a !== 'number' || typeof callArgs.b !== 'number') {
          return errorFor(message, -32602, 'invalid params: a and b must be integers');
        }
        if (logOnCall)
          send({
            jsonrpc: '2.0',
            method: 'notifications/logging/message',
            params: { level: 'info', logger: 'test', data: 'sum called' },
          });
        return resultFor(message, {
          content: [{ type: 'text', text: String(callArgs.a + callArgs.b) }],
        });
      }
      if (name === 'delete_file') {
        if (logOnCall)
          send({
            jsonrpc: '2.0',
            method: 'notifications/logging/message',
            params: { level: 'info', logger: 'test', data: 'delete_file called' },
          });
        return resultFor(message, {
          content: [{ type: 'text', text: `deleted ${String(callArgs?.path ?? '?')}` }],
        });
      }
      return errorFor(message, -32602, `unknown tool: ${String(name ?? '?')}`);
    }

    case 'resources/list':
      if (!initialized) return errorFor(message, -32001, 'server is not initialized');
      if (paginate) {
        const page = Number(message.params?.cursor ?? '0') || 0;
        const pageSize = 1;
        const slice = resources.slice(page * pageSize, page * pageSize + pageSize);
        const hasMore = (page + 1) * pageSize < resources.length;
        return resultFor(message, {
          resources: slice,
          nextCursor: hasMore ? String(page + 1) : undefined,
        });
      }
      return resultFor(message, { resources });

    case 'resources/templates/list':
      return resultFor(message, { resourceTemplates });

    case 'prompts/list':
      if (!initialized) return errorFor(message, -32001, 'server is not initialized');
      return resultFor(message, { prompts });

    case 'completion/complete':
      return resultFor(message, {
        completion: { values: ['alpha', 'beta', 'gamma'], hasMore: false, total: 3 },
      });

    case 'ping':
      return resultFor(message, {});

    default:
      return errorFor(message, -32601, `method not found: ${String(message.method)}`);
  }
}

if (banner) {
  process.stdout.write('Fake MCP server starting...\n');
}

if (crash) {
  process.stdout.write('{"jsonrpc":"2.0","id":0,"result":{"partial":true}}\n');
  process.exit(3);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed === '') return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  void handle(message);
});
rl.on('close', () => process.exit(0));
