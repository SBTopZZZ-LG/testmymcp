import readline from 'node:readline';

const envName = process.env.FIXTURE_ENV_NAME ?? 'FIXTURE_VALUE';

const tools = [
  {
    name: 'read_env',
    description: 'return the value of the FIXTURE env var',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function resultFor(request, result) {
  send({ jsonrpc: '2.0', id: request.id, result });
}

function errorFor(request, code, message) {
  send({ jsonrpc: '2.0', id: request.id, error: { code, message } });
}

function handle(message) {
  if (message.id === undefined) return;
  switch (message.method) {
    case 'initialize':
      return resultFor(message, {
        protocolVersion: '2025-11-25',
        serverInfo: { name: 'env-server', version: '1.0.0' },
        capabilities: { tools: {} },
      });
    case 'tools/list':
      return resultFor(message, { tools });
    case 'tools/call':
      if (message.params?.name === 'read_env') {
        return resultFor(message, {
          content: [{ type: 'text', text: String(process.env[envName] ?? '') }],
        });
      }
      return errorFor(message, -32602, `unknown tool: ${String(message.params?.name ?? '?')}`);
    default:
      return errorFor(message, -32601, `method not found: ${String(message.method)}`);
  }
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
