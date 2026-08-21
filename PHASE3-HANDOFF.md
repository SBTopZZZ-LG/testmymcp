# Phase 3 (Modern protocol, 2026-07-28) — Handoff / Resume Notes

> Status: **ALL PHASE 3 ITEMS IMPLEMENTED & VERIFIED.** `ModernProtocolAdapter` is wired
> through the factory, and the modern stateless path is exercised over streamable HTTP (and stdio)
> against modern fixtures: discover, `_meta`, MRTR auto-retry (now method/input-type aware),
> header routing, `subscriptions/listen` streams, `x-mcp-header` → `Mcp-Param-*` mirroring, the
> **Tasks extension** polling loop, **caching/TTL** validation, and the **-32021** capability
> rejection path. Full verification chain is green (typecheck, lint, build, 204 tests). This file
> tracks what was built.

---

## 1. What was built

### 1.1 Modern protocol module (`src/protocols/modern/`)
- `adapter.ts` — `ModernProtocolAdapter` implements `ProtocolAdapter`. Key differences
  from Legacy:
  - No `initialize` handshake: `initialize()` performs `server/discover`, populates a
    `NegotiatedSession`, and treats it as the session (cached; subsequent calls no-op).
  - Every request gets per-request `_meta` via `withRequestMeta`/`buildRequestMeta`
    (`io.modelcontextprotocol/protocolVersion`, `clientInfo`, `clientCapabilities`).
  - `rawRequest` runs an **MRTR loop**: if the server returns `input_required`, the adapter
    collects inputResponses, echoes `requestState` verbatim, and retries with a **new** JSON-RPC id.
  - `shutdown()`/`disconnect()` stop the transport with a bounded wait; no
    `notifications/shutdown` (legacy-only).
- `request-meta.ts` — `_meta` builder + `withRequestMeta` param injection.
- `discover.ts` — `parseDiscoverResult` (supportedVersions, capabilities incl. extensions,
  serverInfo from `_meta`, ttl/cacheScope), `selectSupportedVersion`.
- `mrtr.ts` — `isInputRequiredResult`, `parseInputRequests`, `parseRequestState`,
  `buildInputRetryParams`.
- `result.ts` — resultType helpers (task/complete detection).
- `util.ts` — `isRecord`/`asRecord`.
- `index.ts` — re-exports.

### 1.2 Factory (`src/core/protocol/factory.ts`)
- `create('modern', ...)` / `create('2026-07-28', ...)` now returns a
  `ModernProtocolAdapter` (the old `throw UnsupportedProtocolVersionError` is gone).
- New factory options: `extensions`, `autoMrtr`.

### 1.3 Capabilities (`src/core/protocol/capabilities.ts`)
- `ServerCapabilities` adds `toolListChanged`, `resourceListChanged`, `resourceSubscribe`,
  `promptListChanged`, `extensions`.
- `ClientCapabilities` adds `elicitationForm`, `elicitationUrl`, `samplingContext`,
  `samplingTools`, `extensions`.
- `toClientCapabilitiesJson` now emits structured `elicitation{form,url}` /
  `sampling{context,tools}` and `extensions`.

### 1.4 Streamable HTTP transport (`src/transports/http/streamable-http-transport.ts`)
- New `era: 'modern' | 'legacy'` option. Modern mode:
  - No `Mcp-Session-Id` echo (sessions removed in 2026-07-28).
  - Sends `Mcp-Method` and `Mcp-Name` request headers (with Base64 sentinel encoding for
    non-plain-ASCII `Mcp-Name` values via `encodeHeaderValue`).
  - Always advertises `Accept: application/json, text/event-stream`.
- `header-routing.ts` `validateJsonResponseHeaders` gained a `modern` flag so `2026-07-28`
  is a valid `MCP-Protocol-Version` on responses.

### 1.4b `x-mcp-header` tool-parameter → request-header mirroring (`src/transports/http/x-mcp-header.ts`)
- `collectXMcpHeaders` walks an inputSchema's `properties` (recursively for nested objects),
  recording each `x-mcp-header`-annotated property's full path + decoded primitive type.
- `validateToolHeaders` enforces spec constraints: non-empty field-name token, no CR/LF,
  case-insensitively unique header names, and primitive-only types (`integer`/`string`/`boolean`,
  **not** `number`). Returns `{valid, reason, annotations}`.
- `buildMcpParamHeaders(schema, args)` reads each annotated value along its path, applies
  value encoding (`encodeParamHeader` → `encodeHeaderValue` with Base64 sentinel for unsafe
  values), and returns the `Mcp-Param-{Name}` → value map. Null/absent params are omitted.
- `sanitizeToolHeaders(tool)` wraps `validateToolHeaders` for the tool-definition rejection rule.
- The transport's `send()` (modern mode) calls `buildMcpParamHeaders` on `tools/call` using
  tool schemas registered via `setToolInputSchemas` (populated by the discovery suite, which
  also rejects tools whose annotations fail `validateToolHeaders`). The modern adapter exposes
  `setToolSchemas(tools)` to bridge the engine → transport.
- `src/transports/http/index.ts` re-exports the module.

### 1.4c `subscriptions/listen` client support
- `src/transports/transport.ts`: new `ListenStream` interface (`id`, `events`, `onFrame`,
  `closed`, `cancel`).
- `src/transports/http/streamable-http-transport.ts`: `listen()`, `consumeOpenStream()`,
  `handleOpenFrame()`, `ListenStreamImpl` — opens a long-lived SSE stream, forwards frames via
  an observer + `emit`.
- `src/protocols/modern/adapter.ts`: `subscribe(filter)` + `ModernSubscription` collect the
  `subscriptionId` (from `_meta['io.modelcontextprotocol/subscriptionId']`) and observed
  notifications/events.

### 1.4d Tasks extension (`io.modelcontextprotocol/tasks`)
- `src/protocols/modern/adapter.ts`: `tasksGet` / `tasksUpdate` / `tasksCancel` and `pollTask`
  (loops `tasks/get` until a terminal status; answers `input_required` via `tasks/update`;
  bounded by `maxPollMs` / `pollIntervalMs`). `invokeTool` (shared capability suite) follows a
  `task` result to completion when the adapter exposes `pollTask`.
- `src/protocols/modern/mrtr.ts`: `buildInputResponse(method, params)` returns a method-aware
  input response (elicitation → accept w/ schema-derived content; sampling → minimal message;
  roots/list → empty list), replacing the old blind `{action:'accept', content:{}}`.
- `src/protocols/modern/result.ts`: `isTaskResult` already detects `resultType:'task'`.
- `tests/fixtures/modern-server.js`: added a `slow` tool returning `CreateTaskResult` and
  `tasks/get` / `tasks/update` / `tasks/cancel` handlers; `server/discover` advertises
  `extensions['io.modelcontextprotocol/tasks']`.

### 1.4e Caching/TTL validation
- `src/suites/discovery.ts`: `collectList` now captures the first-page raw result (`firstRaw`);
  `checkCaching` validates `ttlMs` (non-negative integer) and `cacheScope` (`public`/`private`)
  on `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list`. Absent hints →
  warning; invalid values → warning; present-and-valid → pass.

### 1.4f MRTR input-response fidelity
- The MRTR loop no longer blindly accepts every input request. `collectInputResponses` uses
  `buildInputResponse` to answer each surfaced request based on its method and (for elicitation)
  the requested schema, so the conformance tester answers inputs faithfully.

### 1.4g Modern stdio path
- `tests/fixtures/modern-stdio-server.js`: new stateless 2026-07-28 server over stdio (NDJSON),
  responds to `server/discover` / `tools/list` / `tools/call` (no `initialize`).
- `tests/integration/engine-modern-stdio.test.ts`: drives the `ModernProtocolAdapter` over a
  `StdioTransport` end-to-end.

### 1.5 Suites
- `src/suites/protocol-modern.ts` — modern protocol suite (`server/discover` + version/capability
  checks, stateless). `suites/index.ts` routes `protocol` to the modern runner when `ctx.era === 'modern'`.
- `src/suites/discovery.ts`, `src/suites/protocol.ts` now use `ctx.transport` instead of a hardcoded `'stdio'`.
- `src/engine/ctx.ts` + `src/engine/engine.ts` — `SuiteContext` gained `transport` and `era`.
- `src/engine/result.ts` — `resolveErrorLayer` treats `-32020/-32021/-32022` as protocol-layer
  (regardless of method).

### 1.6 CLI
- `index.ts`: `--era legacy|modern` and `--protocol-version <version>` on both `http` and `stdio`.
  (Renamed from `--version` to avoid the commander built-in collision.)
- `http.ts` / `stdio.ts`: thread `era`/`version` through to the factory + transport.

### 1.7 Tests (34 files, 204 tests)
- `tests/unit/modern-adapter.test.ts` — discover-instead-of-initialize, per-request `_meta`,
  spec error codes, MRTR auto-retry, shutdown.
- `tests/unit/modern-helpers.test.ts` — request-meta, discover parse, mrtr, `buildInputResponse`
  fidelity, result types.
- `tests/unit/capabilities.test.ts` — extensions + structured client caps.
- `tests/unit/http-header-routing.test.ts` — added modern-version validation cases.
- `tests/unit/x-mcp-header.test.ts` — `collectXMcpHeaders`/`validateToolHeaders`/
  `buildMcpParamHeaders`/`sanitizeToolHeaders` (15 cases).
- `tests/integration/engine-modern.test.ts` — full engine run over streamable HTTP against the
  modern fixture (passes), MRTR tool call, unsupported-version (-32022) rejection,
  `-32021` MissingRequiredClientCapability path, `subscriptions/listen` stream + change
  notifications, `x-mcp-header` → `Mcp-Param-*` mirroring, and Tasks-extension polling.
- `tests/integration/engine-modern-stdio.test.ts` — modern adapter over `StdioTransport` against
  `modern-stdio-server.js` (discover + tool call).
- `tests/fixtures/modern-server.js` — stateless 2026-07-28 fixture (`--unsupported-version`,
  `--require-capability`); `subscriptions/listen` long-lived SSE, `echo` tool with `x-mcp-header`
  annotations, and `slow` task tool + `tasks/*` handlers.
- `tests/fixtures/modern-stdio-server.js` — new stateless stdio (NDJSON) modern fixture.

---

## 2. Verification done
```
npm run typecheck            OK
npm run lint                 OK   (spec-src added to ignores)
npm run build                OK
npm test                     204/204 (34 files)
CLI smoke:
  http --era modern          OK  0 fail (modern fixture; caching/TTL + tasks exercised)
  http (legacy streamable)   OK  regression-clean
```

Note: `spec-src/` was added to `eslint.config.mjs` ignores (it carries its own config and
is a gitignored doc clone).

---

## 3. What still needs to be done (Phase 3 remainder)

All Phase 3 items are implemented and verified:

1. ~~**`subscriptions/listen`**~~ — DONE: `ListenStream` + transport `listen()` +
   adapter `subscribe()`/`ModernSubscription`; integration test passes. (Spec §10.)
2. ~~**`x-mcp-header` / `Mcp-Param-{Name}`**~~ — DONE: `x-mcp-header.ts`
   (`collect`/`validate`/`build`/`sanitize`), transport mirroring on `tools/call`, discovery
   suite rejection of invalid tool annotations, end-to-end CLI + integration test. (Spec §6.3.)
3. ~~**Tasks extension**~~ — DONE: adapter `tasksGet`/`tasksUpdate`/`tasksCancel`/`pollTask`,
   capability-suite task-following, fixture `slow` tool + `tasks/*` handlers, integration test. (Spec §17.)
4. ~~**Caching/TTL validation**~~ — DONE: `checkCaching` validates `ttlMs`/`cacheScope` on all
   cacheable lists in the discovery suite. (Spec §11/§19.)
5. ~~**MRTR input-response fidelity**~~ — DONE: `buildInputResponse` answers each surfaced
   input request by method (elicitation/sampling/roots) instead of blind accept. (Spec §19.)
6. ~~**Modern stdio path**~~ — DONE: `modern-stdio-server.js` fixture + `engine-modern-stdio`
   integration test driving the modern adapter over `StdioTransport`.
7. ~~**`-32021` suite coverage**~~ — DONE: integration test asserts `MissingRequiredClientCapability`
   when the server requires an unadvertised capability. (Spec §2/§19.)

---

## 4. Relevant files
- `src/protocols/modern/*` — new modern module
- `src/core/protocol/factory.ts`, `src/core/protocol/capabilities.ts`
- `src/transports/http/streamable-http-transport.ts`, `src/transports/http/header-routing.ts`, `src/transports/http/x-mcp-header.ts`
- `src/suites/protocol-modern.ts`, `src/suites/protocol.ts`, `src/suites/discovery.ts`, `src/suites/index.ts`
- `src/engine/ctx.ts`, `src/engine/engine.ts`, `src/engine/result.ts`
- `src/cli/index.ts`, `src/cli/http.ts`, `src/cli/stdio.ts`
- `tests/integration/engine-modern.test.ts`, `tests/unit/modern-*.test.ts`, `tests/fixtures/modern-server.js`
- Spec inventory: `PHASE3-SPEC-INVENTORY.md`
