// Shared helpers for HTTP (streamable) MCP fixture servers. Single-purpose
// fixtures import these so matrix fixtures stay tiny (~80-150 lines).
import http from 'node:http';

export const DEFAULT_LEGACY_VERSION = '2025-11-25';
export const MODERN_VERSION = '2026-07-28';

export function argsOf() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(`--${name}`);
  const value = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : dflt;
  };
  return { args, flag, value, port: Number(value('port', '8937')) };
}

export function responseHeaders({
  version = DEFAULT_LEGACY_VERSION,
  method = '',
  name = 'fixture',
  sessionId,
} = {}) {
  const headers = {
    'MCP-Protocol-Version': version,
    'Mcp-Method': method,
    'Mcp-Name': name,
  };
  if (sessionId !== undefined && sessionId !== null) headers['Mcp-Session-Id'] = sessionId;
  return headers;
}

export function applyHeaders(res, opts = {}) {
  for (const [k, v] of Object.entries(responseHeaders(opts))) res.setHeader(k, v);
}

export function jsonResponse(res, payload, opts = {}) {
  applyHeaders(res, opts);
  res.writeHead(opts.code ?? 200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export function sseResponse(res, payload, opts = {}) {
  applyHeaders(res, opts);
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

export function acceptsEventStream(acceptHeader) {
  return typeof acceptHeader === 'string' && /text\/event-stream/i.test(acceptHeader);
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export const parseError = {
  jsonrpc: '2.0',
  id: null,
  error: { code: -32700, message: 'parse error' },
};

export function makeResult(message, result) {
  return { jsonrpc: '2.0', id: message.id, result };
}

export function makeError(message, code, text) {
  return { jsonrpc: '2.0', id: message.id, error: { code, message: text } };
}

function resolveHeaderMethod(methodOverride, method) {
  if (typeof methodOverride === 'function') return methodOverride(method) ?? method;
  if (typeof methodOverride === 'string') return methodOverride;
  return method;
}

/**
 * Build a `handler` for `listen` that owns a legacy session map and applies
 * header options (session id, protocol version, Mcp-Method override, server
 * name). `respond(message, session)` returns a JSON-RPC payload (or null for
 * notifications). This keeps sessionful legacy HTTP fixtures to a few lines.
 */
export function sessionHandler(respond, opts = {}) {
  const sessions = new Map();
  const withSessionId = opts.withSessionId ?? true;
  const headerVersion = opts.headerVersion ?? opts.version ?? DEFAULT_LEGACY_VERSION;
  const serverName = opts.name ?? 'fixture';

  return ({ message, headers, res, acceptsEventStream }) => {
    const sessHeader =
      typeof headers['mcp-session-id'] === 'string' ? headers['mcp-session-id'] : undefined;
    let session = sessHeader ? sessions.get(sessHeader) : undefined;

    if (message.method === 'initialize' && !session) {
      session = { id: `sess_${Math.random().toString(36).slice(2, 10)}`, initialized: true };
      sessions.set(session.id, session);
    }

    const payload = respond ? respond(message, session) : null;
    if (payload === null || payload === undefined) return null;

    const headerOpts = {
      version: headerVersion,
      name: serverName,
      method: resolveHeaderMethod(opts.methodOverride, message.method),
    };
    if (withSessionId && session) headerOpts.sessionId = session.id;
    else if (withSessionId) headerOpts.sessionId = null;

    if (acceptsEventStream) sseResponse(res, payload, headerOpts);
    else jsonResponse(res, payload, headerOpts);
    return null; // response already sent
  };
}

/**
 * Start a streamable-HTTP fixture. `handler` receives
 * `{ message, headers, req, res, url, jsonResponse, sseResponse, makeResult,
 *   makeError, acceptsEventStream }`. It may EITHER return a JSON-RPC payload
 * (sent back by this helper, JSON or SSE per the Accept header) OR send a
 * response itself and return null. A null return with nothing sent is treated
 * as an accepted notification (HTTP 202).
 */
export function listen({
  port,
  handler,
  reverseHandler,
  onStartup,
  version = DEFAULT_LEGACY_VERSION,
  name = 'fixture',
}) {
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
        body = await readBody(req);
      } catch {
        jsonResponse(res, parseError, { method: '' });
        return;
      }
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        jsonResponse(res, parseError, { method: '' });
        return;
      }
      const acepts = () => acceptsEventStream(req.headers.accept);
      const result = handler
        ? handler({
            message,
            headers: req.headers,
            req,
            res,
            url,
            jsonResponse,
            sseResponse,
            makeResult,
            makeError,
            acceptsEventStream: acepts(),
          })
        : reverseHandler({ body, req, res, url, jsonResponse, sseResponse, makeResult, makeError });
      if (res.headersSent) return;
      if (result === null || result === undefined) {
        res.writeHead(202, { 'Content-Type': 'text/plain' });
        res.end('Accepted');
        return;
      }
      const headerOpts = { method: message.method, version, name };
      if (acceptsEventStream(req.headers.accept)) sseResponse(res, result, headerOpts);
      else jsonResponse(res, result, headerOpts);
    })();
  });

  server.listen(port, '127.0.0.1', () => {
    onStartup?.(port);
    process.stderr.write(`listening on http://127.0.0.1:${port}\n`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}
