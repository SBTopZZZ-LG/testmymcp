import http from 'node:http';

const args = process.argv.slice(2);

const HELP_FLAG = args.includes('--help') || args.includes('-h');
const badMethodHeader = args.includes('--bad-method-header');
const noSessionId = args.includes('--no-session-id');
const garbageSse = args.includes('--garbage-sse');
const paginate = args.includes('--paginate');

let port = 8937;
const portIdx = args.indexOf('--port');
if (portIdx !== -1 && args[portIdx + 1] !== undefined) {
  port = Number(args[portIdx + 1]);
}

if (HELP_FLAG) {
  process.stderr.write(
    [
      'HTTP MCP fixture server',
      '',
      'Usage: node tests/fixtures/http-server.js [options]',
      '',
      'Options:',
      '  --port <n>            listen port (default 8937)',
      '  --bad-method-header   send a wrong Mcp-Method on JSON responses',
      '  --no-session-id       never return Mcp-Session-Id',
      '  --garbage-sse         emit occasional malformed SSE data lines',
      '  -h, --help            show this help',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

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

function makeResult(request, result) {
  return { jsonrpc: '2.0', id: request.id, result };
}

function makeError(request, code, message) {
  return { jsonrpc: '2.0', id: request.id, error: { code, message } };
}

// Shared MCP request handling (mirrors fake-server.js). `initialized` is
// per-session so the session lifecycle is independent across clients.
function handleMessage(message, session) {
  if (message.id === undefined) {
    if (message.method === 'notifications/initialized') session.initialized = true;
    return null; // notification -> no response
  }

  switch (message.method) {
    case 'initialize': {
      const requested = message.params?.protocolVersion;
      if (typeof requested === 'string' && !SUPPORTED_VERSIONS.has(requested)) {
        return makeError(message, -32602, `unsupported protocol version: ${requested}`);
      }
      session.initialized = true;
      return makeResult(message, {
        protocolVersion: SERVER_VERSION,
        serverInfo: { name: 'fake-mcp-server', version: '1.0.0' },
        capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
      });
    }

    case 'tools/list':
      if (!session.initialized) return makeError(message, -32001, 'server is not initialized');
      if (paginate) {
        const page = Number(message.params?.cursor ?? '0') || 0;
        const pageSize = 1;
        const slice = tools.slice(page * pageSize, page * pageSize + pageSize);
        const hasMore = (page + 1) * pageSize < tools.length;
        return makeResult(message, {
          tools: slice,
          nextCursor: hasMore ? String(page + 1) : undefined,
        });
      }
      return makeResult(message, { tools });

    case 'tools/call': {
      if (!session.initialized) return makeError(message, -32001, 'server is not initialized');
      const name = message.params?.name;
      const callArgs = message.params?.arguments;
      if (name === 'sum') {
        if (!callArgs || typeof callArgs.a !== 'number' || typeof callArgs.b !== 'number') {
          return makeError(message, -32602, 'invalid params: a and b must be integers');
        }
        return makeResult(message, {
          content: [{ type: 'text', text: String(callArgs.a + callArgs.b) }],
        });
      }
      if (name === 'delete_file') {
        return makeResult(message, {
          content: [{ type: 'text', text: `deleted ${String(callArgs?.path ?? '?')}` }],
        });
      }
      return makeError(message, -32602, `unknown tool: ${String(name ?? '?')}`);
    }

    case 'resources/list':
      if (!session.initialized) return makeError(message, -32001, 'server is not initialized');
      if (paginate) {
        const page = Number(message.params?.cursor ?? '0') || 0;
        const pageSize = 1;
        const slice = resources.slice(page * pageSize, page * pageSize + pageSize);
        const hasMore = (page + 1) * pageSize < resources.length;
        return makeResult(message, {
          resources: slice,
          nextCursor: hasMore ? String(page + 1) : undefined,
        });
      }
      return makeResult(message, { resources });

    case 'resources/templates/list':
      return makeResult(message, { resourceTemplates });

    case 'prompts/list':
      if (!session.initialized) return makeError(message, -32001, 'server is not initialized');
      return makeResult(message, { prompts });

    case 'completion/complete':
      return makeResult(message, {
        completion: { values: ['alpha', 'beta', 'gamma'], hasMore: false, total: 3 },
      });

    case 'ping':
      return makeResult(message, {});

    default:
      return makeError(message, -32601, `method not found: ${String(message.method)}`);
  }
}

function createSession() {
  // Deterministic-ish, unique-enough session id for tests.
  const id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return { id, initialized: false };
}

// @param session nullable
function applyResponseHeaders(res, method, session) {
  if (!noSessionId && session) {
    res.setHeader('Mcp-Session-Id', session.id);
  }
  res.setHeader('MCP-Protocol-Version', SERVER_VERSION);
  const m = badMethodHeader && method === 'initialize' ? 'initialize-WRONG' : method;
  res.setHeader('Mcp-Method', m);
  res.setHeader('Mcp-Name', 'fakeserver');
}

// ---- Legacy SSE stream management -----------------------------------------

const sseClients = new Set();

function writeSse(res, event, data) {
  if (garbageSse && Math.random() < 0.3) {
    res.write('data: this is not json{{{::\n\n');
  }
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendToAllSseClients(obj) {
  for (const res of sseClients) {
    try {
      writeSse(res, 'message', obj);
    } catch {
      sseClients.delete(res);
    }
  }
}

function handleSseRequest(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.flushHeaders?.();

  const session = createSession();

  // Legacy handshake event: tells the client the messages endpoint + session.
  // The endpoint URI is sent as a raw string (not JSON-encoded) per the legacy
  // SSE contract, so the client can use it directly as a POST target.
  const messagesUrl = `/messages?sessionId=${session.id}`;
  res.write(`event: endpoint\n`);
  res.write(`data: ${messagesUrl}\n\n`);

  res.write(': connected\n\n');

  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
  res.on('error', () => sseClients.delete(res));

  // Keep the session reachable by its id so /messages can resolve it.
  sseSessions.set(session.id, session);
  res._mcpSession = session;
}

// ---- Legacy SSE messages endpoint -----------------------------------------

const sseSessions = new Map();

function handleMessages(req, res, url) {
  const sessionId = url.searchParams.get('sessionId');
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    let message;
    try {
      message = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'parse error' },
        }),
      );
      return;
    }

    const session = sseSessions.get(sessionId) || createSession();
    if (sessionId) sseSessions.set(sessionId, session);

    // The response is routed back over the SSE stream to the client (202 Accepted).
    res.writeHead(202, {
      'Content-Type': 'text/plain',
      'MCP-Protocol-Version': SERVER_VERSION,
    });
    res.end('Accepted');

    const response = handleMessage(message, session);
    if (response) {
      sendToAllSseClients(response);
    } else if (message.id === undefined && message.method === 'notifications/initialized') {
      // handled inside handleMessage
    }
  });
}

// ---- Streamable HTTP ------------------------------------------------------

function acceptsEventStream(acceptHeader) {
  if (!acceptHeader) return false;
  return /text\/event-stream/i.test(acceptHeader);
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

function sendJsonResponse(res, code, payload, method, session) {
  applyResponseHeaders(res, method, session);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendSseResponse(res, payload, method, session) {
  applyResponseHeaders(res, method, session);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  res.write(`event: message\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  res.end();
}

function handleStreamableHttp(req, res, body) {
  let message;
  try {
    message = JSON.parse(body);
  } catch {
    sendJsonResponse(
      res,
      400,
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } },
      undefined,
      null,
    );
    return;
  }

  const method = message.method;

  const sessionHeader = req.headers['mcp-session-id'];

  if (method === 'initialize') {
    // Fresh session for this request (or reuse if a session header was sent).
    const session = sessionHeader
      ? sseSessions.get(sessionHeader) || createSession()
      : createSession();
    if (sessionHeader) sseSessions.set(sessionHeader, session);
    else sseSessions.set(session.id, session);

    const response = handleMessage(message, session);
    if (acceptsEventStream(req.headers.accept)) {
      sendSseResponse(res, response, method, session);
    } else {
      sendJsonResponse(res, 200, response, method, session);
    }
    return;
  }

  // Non-initialize requests REQUIRE a valid session header.
  if (!sessionHeader) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Mcp-Session-Id required');
    return;
  }

  const session = sseSessions.get(sessionHeader);
  if (!session || !session.initialized) {
    // Session id unknown -> treat as missing/mismatched.
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Mcp-Session-Id required');
    return;
  }

  const response = handleMessage(message, session);
  if (acceptsEventStream(req.headers.accept)) {
    sendSseResponse(res, response, method, session);
  } else {
    sendJsonResponse(res, 200, response, method, session);
  }
}

// ---- HTTP server ----------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

  if (url.pathname === '/sse' && req.method === 'GET') {
    handleSseRequest(req, res);
    return;
  }

  if (url.pathname === '/messages' && req.method === 'POST') {
    handleMessages(req, res, url);
    return;
  }

  if (url.pathname === '/' && req.method === 'POST') {
    (async () => {
      let body;
      try {
        body = await parseBody(req);
      } catch {
        sendJsonResponse(
          res,
          400,
          { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } },
          undefined,
          null,
        );
        return;
      }
      handleStreamableHttp(req, res, body);
    })();
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.on('error', (err) => {
  process.stderr.write(`server error: ${err.message}\n`);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  process.stderr.write(`listening on http://127.0.0.1:${port}\n`);
});

function shutdown() {
  for (const res of sseClients) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
