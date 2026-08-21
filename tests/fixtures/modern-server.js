import http from 'node:http';

const args = process.argv.slice(2);
const HELP_FLAG = args.includes('--help') || args.includes('-h');
const unsupported = args.includes('--unsupported-version');
const requireCapability = args.includes('--require-capability');
const paginate = args.includes('--paginate');

let port = 8947;
const portIdx = args.indexOf('--port');
if (portIdx !== -1 && args[portIdx + 1] !== undefined) port = Number(args[portIdx + 1]);

if (HELP_FLAG) {
  process.stderr.write(
    [
      'Modern MCP fixture server (2026-07-28, stateless)',
      '',
      'Usage: node tests/fixtures/modern-server.js [options]',
      '',
      'Options:',
      '  --port <n>             listen port (default 8947)',
      '  --unsupported-version  reject every request with UnsupportedProtocolVersionError (-32022)',
      '  --bad-meta             require the _meta protocol fields; echo them in a way the test inspects',
      '  --require-capability   demand elicitation capability, else MissingRequiredClientCapabilityError (-32021)',
      '  -h, --help             show this help',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const SUPPORTED = ['2026-07-28'];
const SERVER_VERSION = '2026-07-28';

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
    name: 'echo',
    description: 'echo annotated parameters and report the Mcp-Param headers received',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', 'x-mcp-header': 'Region' },
        count: { type: 'integer', 'x-mcp-header': 'Count' },
        note: { type: 'string', 'x-mcp-header': 'X-Note' },
        rate: { type: 'number' },
      },
      required: ['region'],
      additionalProperties: false,
    },
  },
  {
    name: 'big_echo',
    description: 'echo the data payload back verbatim (no header mirroring)',
    inputSchema: {
      type: 'object',
      properties: { data: { type: 'string' } },
      required: ['data'],
      additionalProperties: false,
    },
  },
  {
    name: 'slow',
    description: 'return a task result that must be polled to completion',
    inputSchema: {
      type: 'object',
      properties: { label: { type: 'string' } },
      required: ['label'],
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
const prompts = [
  { name: 'greeting', description: 'greet someone', arguments: [{ name: 'who', required: true }] },
];

const tasks = new Map();

function readMeta(message) {
  const meta =
    message.params && typeof message.params === 'object' ? message.params._meta : undefined;
  if (meta === null || typeof meta !== 'object') return undefined;
  return meta;
}

function checkProtocol(message) {
  const meta = readMeta(message);
  const version = meta ? meta['io.modelcontextprotocol/protocolVersion'] : undefined;
  if (typeof version !== 'string' || !SUPPORTED.includes(version)) {
    return {
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32022,
        message: 'Unsupported protocol version',
        data: { supported: SUPPORTED, requested: version },
      },
    };
  }
  if (message.id !== undefined && !meta) {
    return { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'missing _meta' } };
  }
  return null;
}

function handleMessage(message, requestHeaders) {
  if (message.id === undefined) return null;

  const protoError = checkProtocol(message);
  if (protoError) return protoError;

  if (unsupported) {
    return {
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32022,
        message: 'Unsupported protocol version',
        data: { supported: SUPPORTED, requested: '2026-07-28' },
      },
    };
  }

  const meta = readMeta(message) ?? {};

  if (requireCapability && message.method !== 'server/discover') {
    const caps = meta['io.modelcontextprotocol/clientCapabilities'];
    if (!caps || typeof caps !== 'object' || !caps.elicitation) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32021,
          message: 'Missing required client capability',
          data: { requiredCapabilities: ['elicitation'] },
        },
      };
    }
  }

  switch (message.method) {
    case 'server/discover':
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          resultType: 'complete',
          supportedVersions: SUPPORTED,
          capabilities: {
            tools: { listChanged: true },
            resources: {},
            prompts: {},
            extensions: { 'io.modelcontextprotocol/tasks': {} },
          },
          _meta: {
            'io.modelcontextprotocol/serverInfo': { name: 'modern-fake-server', version: '1.0.0' },
          },
          instructions: 'Modern stateless fixture',
          ttlMs: 60000,
          cacheScope: 'public',
        },
      };

    case 'tools/list':
      if (paginate) {
        const page = Number(message.params?.cursor ?? '0') || 0;
        const pageSize = 1;
        const slice = tools.slice(page * pageSize, page * pageSize + pageSize);
        const hasMore = (page + 1) * pageSize < tools.length;
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            resultType: 'complete',
            tools: slice,
            nextCursor: hasMore ? String(page + 1) : undefined,
            ttlMs: 60000,
            cacheScope: 'public',
          },
        };
      }
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: { resultType: 'complete', tools, ttlMs: 60000, cacheScope: 'public' },
      };

    case 'tools/call': {
      const name = message.params?.name;
      const callArgs = message.params?.arguments;
      if (name === 'sum') {
        if (!callArgs || typeof callArgs.a !== 'number' || typeof callArgs.b !== 'number') {
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32602, message: 'a and b must be integers' },
          };
        }
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            resultType: 'complete',
            content: [{ type: 'text', text: String(callArgs.a + callArgs.b) }],
          },
        };
      }
      if (name === 'echo') {
        const headers = requestHeaders || {};
        const picked = {};
        for (const key of ['mcp-param-region', 'mcp-param-count', 'mcp-param-x-note']) {
          if (headers[key] !== undefined) picked[key] = headers[key];
        }
        const body = ['region', 'count', 'note', 'rate']
          .map((k) => `${k}=${callArgs?.[k] ?? ''}`)
          .join(',');
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            resultType: 'complete',
            content: [
              { type: 'text', text: body },
              { type: 'text', text: `headers=${JSON.stringify(picked)}` },
            ],
          },
        };
      }
      if (name === 'big_echo') {
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            resultType: 'complete',
            content: [{ type: 'text', text: String(callArgs?.data ?? '') }],
          },
        };
      }
      if (name === 'slow') {
        const label = callArgs?.label ?? 'x';
        tasks.set('task-1', { label: String(label), status: 'working', polls: 0 });
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            resultType: 'task',
            taskId: 'task-1',
            status: 'working',
            ttlMs: 5000,
            pollIntervalMs: 100,
          },
        };
      }
      if (name === 'ask') {
        // exercise MRTR: first ask for input, then accept it on retry.
        if (!message.params?.inputResponses) {
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              resultType: 'input_required',
              inputRequests: {
                confirm: {
                  method: 'elicitation/create',
                  params: {
                    mode: 'form',
                    message: 'please confirm',
                    requestedSchema: {
                      type: 'object',
                      properties: { ok: { type: 'boolean' } },
                      required: ['ok'],
                    },
                  },
                },
              },
              requestState: 'state-1',
            },
          };
        }
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            resultType: 'complete',
            content: [{ type: 'text', text: 'confirmed' }],
            evidence: message.params?.requestState,
          },
        };
      }
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32602, message: `unknown tool: ${String(name ?? '?')}` },
      };
    }

    case 'tasks/get': {
      const id = message.params?.taskId;
      const task = tasks.get(id);
      if (task === undefined) {
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32602, message: `unknown task: ${String(id ?? '?')}` },
        };
      }
      task.polls += 1;
      if (task.polls >= 2 || task.status !== 'working') {
        task.status = 'completed';
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            resultType: 'task',
            taskId: id,
            status: 'completed',
            ttlMs: 5000,
            pollIntervalMs: 100,
            content: [{ type: 'text', text: `done:${task.label}` }],
          },
        };
      }
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          resultType: 'task',
          taskId: id,
          status: 'working',
          ttlMs: 5000,
          pollIntervalMs: 100,
        },
      };
    }

    case 'tasks/update': {
      const id = message.params?.taskId;
      const task = tasks.get(id);
      if (task === undefined) {
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32602, message: `unknown task: ${String(id ?? '?')}` },
        };
      }
      task.status = 'completed';
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          resultType: 'task',
          taskId: id,
          status: 'completed',
          ttlMs: 5000,
          pollIntervalMs: 100,
          content: [{ type: 'text', text: `updated:${task.label}` }],
        },
      };
    }

    case 'tasks/cancel': {
      const id = message.params?.taskId;
      const task = tasks.get(id);
      if (task === undefined) {
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32602, message: `unknown task: ${String(id ?? '?')}` },
        };
      }
      task.status = 'cancelled';
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          resultType: 'task',
          taskId: id,
          status: 'cancelled',
          ttlMs: 5000,
          pollIntervalMs: 100,
        },
      };
    }

    case 'resources/list':
      if (paginate) {
        const page = Number(message.params?.cursor ?? '0') || 0;
        const pageSize = 1;
        const slice = resources.slice(page * pageSize, page * pageSize + pageSize);
        const hasMore = (page + 1) * pageSize < resources.length;
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            resultType: 'complete',
            resources: slice,
            nextCursor: hasMore ? String(page + 1) : undefined,
            ttlMs: 60000,
            cacheScope: 'public',
          },
        };
      }
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: { resultType: 'complete', resources, ttlMs: 60000, cacheScope: 'public' },
      };

    case 'prompts/list':
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: { resultType: 'complete', prompts, ttlMs: 60000, cacheScope: 'public' },
      };

    case 'subscriptions/listen': {
      // Without an SSE accept, return an empty listen result (graceful close).
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          resultType: 'complete',
          _meta: { 'io.modelcontextprotocol/subscriptionId': message.id },
        },
      };
    }

    default:
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `method not found: ${String(message.method)}` },
      };
  }
}

function methodNotification(method, subscriptionId) {
  return {
    jsonrpc: '2.0',
    method,
    params: { _meta: { 'io.modelcontextprotocol/subscriptionId': subscriptionId } },
  };
}

/**
 * Open a long-lived SSE stream for subscriptions/listen. Writes the ack frame
 * first, then keeps the stream open for subsequent change notifications.
 */
function sendListenStream(res, subscriptionId) {
  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'MCP-Protocol-Version': SERVER_VERSION,
    'Mcp-Method': 'subscriptions/listen',
    'Mcp-Name': 'modernfakeserver',
  };
  try {
    res.writeHead(200, headers);
    res.flushHeaders?.();
  } catch {
    return null;
  }

  const state = { closed: false };
  const close = () => {
    if (state.closed) return;
    state.closed = true;
    for (const handler of closeHandlers) handler();
    try {
      res.end();
    } catch {
      /* ignore */
    }
  };
  const closeHandlers = [];
  res.on('close', close);
  res.on('error', close);

  // First frame: the acknowledgment, tagged with the subscription id.
  const ack = {
    jsonrpc: '2.0',
    method: 'notifications/subscriptions/acknowledged',
    params: {
      _meta: { 'io.modelcontextprotocol/subscriptionId': subscriptionId },
      notifications: {},
    },
  };
  res.write('event: message\n');
  res.write(`data: ${JSON.stringify(ack)}\n\n`);

  return {
    closed: state.closed,
    onClose(handler) {
      if (state.closed) handler();
      else closeHandlers.push(handler);
    },
    push(payload) {
      if (state.closed) return;
      res.write('event: message\n');
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    },
    close,
  };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function acceptsEventStream(acceptHeader) {
  return /text\/event-stream/i.test(acceptHeader ?? '');
}

function sendJson(res, code, payload, method) {
  res.setHeader('MCP-Protocol-Version', SERVER_VERSION);
  res.setHeader('Mcp-Method', method ?? '');
  res.setHeader('Mcp-Name', 'modernfakeserver');
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendSse(res, payload, method) {
  res.setHeader('MCP-Protocol-Version', SERVER_VERSION);
  res.setHeader('Mcp-Method', method ?? '');
  res.setHeader('Mcp-Name', 'modernfakeserver');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  res.write('event: message\n');
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  res.end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname !== '/' || req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }
  (async () => {
    let body;
    try {
      body = await parseBody(req);
    } catch {
      sendJson(
        res,
        400,
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } },
        undefined,
      );
      return;
    }
    let message;
    try {
      message = JSON.parse(body);
    } catch {
      sendJson(
        res,
        400,
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } },
        undefined,
      );
      return;
    }
    const response = handleMessage(message, req.headers);
    if (message.method === 'subscriptions/listen' && message.id !== undefined) {
      const stream = sendListenStream(res, message.id);
      // Push a few change notifications after a short delay so clients can observe them.
      if (stream !== null) {
        const timer = setInterval(() => {
          if (stream.closed) {
            clearInterval(timer);
            return;
          }
          stream.push(methodNotification('notifications/tools/list_changed', message.id));
          stream.push(methodNotification('notifications/resources/list_changed', message.id));
        }, 200);
        stream.onClose(() => clearInterval(timer));
      }
      return;
    }
    if (response === null) {
      res.writeHead(202, { 'Content-Type': 'text/plain' });
      res.end('Accepted');
      return;
    }
    if (acceptsEventStream(req.headers.accept)) {
      sendSse(res, response, message.method);
    } else {
      sendJson(res, 200, response, message.method);
    }
  })();
});

server.on('error', (err) => {
  process.stderr.write(`server error: ${err.message}\n`);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  process.stderr.write(`listening on http://127.0.0.1:${port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
