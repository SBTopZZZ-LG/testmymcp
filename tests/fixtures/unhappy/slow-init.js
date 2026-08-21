// Unhappy fixture: an initialize response that is deliberately slow (~800 ms),
// then serves normally. Combined with a short client deadline this proves the
// client times out and reports it instead of hanging forever.
import readline from 'node:readline';

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
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
  if (message.id === undefined) return;
  if (message.method === 'initialize') {
    setTimeout(() => {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-11-25',
          serverInfo: { name: 'slow-init', version: '1.0.0' },
          capabilities: { tools: {} },
        },
      });
    }, 800);
    return;
  }
  send({ jsonrpc: '2.0', id: message.id, result: {} });
});
rl.on('close', () => process.exit(0));
