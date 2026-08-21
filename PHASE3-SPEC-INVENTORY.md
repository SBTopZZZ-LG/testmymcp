# Phase 3 — 2026-07-28 Protocol Surface Inventory (Modern)

> Authoritative sources (read in full, in repo order priority):
> 1. `spec-src/docs/specification/2026-07-28/**/*.mdx` — behavioral spec
> 2. `spec-src/schema/2026-07-28/schema.json` — wire/schema definition (source of truth)
> 3. `spec-src/docs/specification/2026-07-28/changelog.mdx` — differences from 2025-11-25
> 4. `spec-src/docs/specification/2026-07-28/deprecated.mdx` — deprecated-feature registry
> 5. `spec-src/docs/extensions/overview.mdx`, `spec-src/docs/extensions/tasks/overview.mdx`
>
> **Rule (per task):** Do **not** infer behavior from `BLUEPRINT.md` when the spec says
> otherwise. Section "Blueprint deltas" below flags every place the existing blueprint is
> out of date vs. the real spec.

---

## 1. Era model & versioning

### 1.1 Terms (`basic/versioning.mdx`)
- **Modern** = revisions `2026-07-28` and later; version/identity/capabilities carried as
  per-request `_meta`.
- **Legacy** = `2025-11-25` and earlier; `initialize` handshake.
- **Dual-era** = supports both.
- No negotiation handshake: every request declares its version.

### 1.2 Version negotiation
- Request must carry `io.modelcontextprotocol/protocolVersion` in `_meta` AND (on HTTP) the
  `MCP-Protocol-Version` header. Mismatch ⇒ `400` + `HeaderMismatch`.
- Unknown/unsupported version ⇒ `UnsupportedProtocolVersionError` **`-32022`**, `data` =
  `{ supported: [...], requested: ... }`. HTTP status `400` (not 404).
- Unknown RPC method ⇒ HTTP `404` + JSON-RPC error `-32601` (Method not found).
- Client SHOULD pick a mutually-supported version from `supported` and retry.
- Missing required `_meta` fields ⇒ `-32602` (Invalid params), HTTP `400`.

### 1.3 Backward-compat detection
- stdio: probe `server/discover`; modern error ⇒ stay modern, else fall back to `initialize`.
- Streamable HTTP: attempt modern request; on `400` inspect body; recognized modern JSON-RPC
  error ⇒ modern (retry w/ supported version), else fall back to `initialize` (then optional
  deprecated HTTP+SSE).
- If only-modern server gets `initialize` ⇒ SHOULD name supported versions in the error.

---

## 2. Core message types (`basic/index.mdx`, `schema.mdx`)

### 2.1 JSON-RPC framing (`core/jsonrpc/messages.ts`)
- Requests: `id` MUST be string|number (never null), unique among outstanding.
- Responses: result responses MUST carry `result` incl. `resultType`; error responses carry
  `error{code,message,data?}`.
- Notifications: MUST NOT have an `id`.
- `resultType` (`basic/index.mdx` §ResultType):
  - `"complete"` — final content.
  - `"input_required"` — carries `InputRequiredResult`.
  - Extensions MAY add values (e.g. `"task"`); unrecognized values MUST be treated invalid.
  - **Absent `resultType` (older server) MUST be treated as `"complete"`.**

### 2.2 Error codes (`basic/index.mdx` §Error Codes)
| Code | Name |
|---|---|
| `-32700` | ParseError |
| `-32600` | InvalidRequest |
| `-32601` | MethodNotFound |
| `-32602` | InvalidParams |
| `-32603` | InternalError |
| `-32020` | **HeaderMismatch** (was -32001) |
| `-32021` | **MissingRequiredClientCapability** (was -32003) |
| `-32022` | **UnsupportedProtocolVersion** (was -32004) |
| `-32602` | resource not found (was -32002) |

Range policy: `-32000..-32019` legacy/grandfathered; `-32020..-32099` spec-reserved.
Must not emit: `-32002` (resource not found — accept still OK from old servers),
`-32042` (URL elicitation required, 2025-11-25 only).

### 2.3 `_meta` reserved keys (`basic/index.mdx` §_meta)
| Key | Type | Required |
|---|---|---|
| `io.modelcontextprotocol/protocolVersion` | string | Yes |
| `io.modelcontextprotocol/clientInfo` | Implementation | No (SHOULD) |
| `io.modelcontextprotocol/clientCapabilities` | ClientCapabilities | Yes |
| `io.modelcontextprotocol/logLevel` | LoggingLevel | No |
| `io.modelcontextprotocol/subscriptionId` | string|number | on listen-stream notifications |
| `progressToken` | ProgressToken | No |
| `traceparent`/`tracestate`/`baggage` | OTEL W3C | No |

- **Response** `_meta`: server SHOULD include `io.modelcontextprotocol/serverInfo`.
- Prefix rules: second label `modelcontextprotocol` or `mcp` ⇒ reserved.

### 2.4 Key-name/extension format (`docs/extensions/overview.mdx`)
- Extension id = `{vendor-prefix}/{extension-name}`, official prefix
  `io.modelcontextprotocol/{name}`. Advertised in the `extensions` field of the respective
  capabilities object. Always disabled by default.

---

## 3. Methods & notifications (authoritative, from `schema.json` unions)

### 3.1 Client → Server requests (`ClientRequest` union)
| Method | Request | Result | File impact |
|---|---|---|---|
| `server/discover` | DiscoverRequest | DiscoverResult (CacheableResult) | **new** |
| `resources/list` | ListResourcesRequest | ListResourcesResult (Paginated+Cacheable) | existing suite |
| `resources/templates/list` | ListResourceTemplatesRequest | ListResourceTemplatesResult (Paginated+Cacheable) | existing |
| `resources/read` | ReadResourceRequest | ReadResourceResult (Cacheable) | existing |
| `subscriptions/listen` | SubscriptionsListenRequest | SubscriptionsListenResult (long-lived stream) | **new** |
| `prompts/list` | ListPromptsRequest | ListPromptsResult (Paginated+Cacheable) | existing |
| `prompts/get` | GetPromptRequest | GetPromptResult | existing |
| `tools/list` | ListToolsRequest | ListToolsResult (Paginated+Cacheable) | existing |
| `tools/call` | CallToolRequest | CallToolResult | existing |
| `completion/complete` | CompleteRequest | CompleteResult | existing |

### 3.2 Client → Server notifications (`ClientNotification` union)
- `notifications/cancelled` — stdio transport only (HTTP cancels by closing the stream).

### 3.3 Server → Client notifications (`ServerNotification` union)
- `notifications/cancelled` (server teardown of a `subscriptions/listen` only)
- `notifications/progress`
- `notifications/resources/list_changed`
- `notifications/resources/updated` (on listen stream, tagged w/ subscriptionId)
- `notifications/subscriptions/acknowledged` (first msg on a listen stream)
- `notifications/prompts/list_changed`
- `notifications/tools/list_changed`
- `notifications/message` (per-request; only if `logLevel` set)
- (extension) `notifications/tasks`

### 3.4 Server→Client input requests via MRTR (inside `InputRequiredResult.inputRequests`)
- `elicitation/create` (ElicitRequest: form | url)
- `sampling/createMessage` (CreateMessageRequest, deprecated feature)
- `roots/list` (ListRootsRequest, deprecated feature)
Also: `ListRootsRequest` etc. Only `InputRequiredResult` on `prompts/get`, `resources/read`,
`tools/call` (MUST NOT on other requests).

### 3.5 Result union (`ServerResult`)
Result | InputRequiredResult | DiscoverResult | ListResourcesResult |
ListResourceTemplatesResult | ReadResourceResult | SubscriptionsListenResult |
ListPromptsResult | GetPromptResult | ListToolsResult | CallToolResult | CompleteResult
(plus extension: `CreateTaskResult` with `resultType:"task"`)

---

## 4. Capabilities (`capabilities.ts`, `server/discover`)

### 4.1 ClientCapabilities (`$defs/ClientCapabilities`)
```
elicitation: { form?: JSONObject, url?: JSONObject }   // empty === form only
extensions:  { [id]: JSONObject }
roots:       {}   (deprecated feature)
sampling:    { context?: JSONObject, tools?: JSONObject }   (deprecated feature)
experimental:{ [name]: JSONObject }
```
- Empty `elicitation` object ≡ form-only support. Client MUST support ≥1 mode.

### 4.2 ServerCapabilities (`$defs/ServerCapabilities`)
```
tools:       { listChanged?: boolean }        // deterministic order SHOULD
resources:   { listChanged?: boolean, subscribe?: boolean }
prompts:     { listChanged?: boolean }
completions: JSONObject
logging:     JSONObject (deprecated feature)
extensions:  { [id]: JSONObject }
experimental:{ [name]: JSONObject }
```

### 4.3 Missing-required-capability
If a request needs a client capability not declared ⇒ `-32021`
`MissingRequiredClientCapabilityError` with `data.requiredCapabilities` (list). HTTP `400`.
→ maps to `capabilities.ts` (needs `requiredCapabilities`-style check) + `MissingRequiredClientCapabilityError` type.

---

## 5. Discover (`server/discover.mdx`) — NEW core method
- Servers **MUST** implement `server/discover`.
- Request params: only `_meta`.
- Result: `supportedVersions: string[]`, `capabilities: ServerCapabilities`,
  `_meta.serverInfo`, `instructions?`, plus CacheableResult fields (`ttlMs`, `cacheScope`).
- Supports caching. Used for stdio era probe + up-front capability discovery.

---

## 6. Transport: Streamable HTTP (`streamable-http.mdx`) — 2026-07-28 shape

### 6.1 Sending (client)
- One HTTP POST per JSON-RPC message to a single MCP endpoint.
- `Accept` MUST include both `application/json` AND `text/event-stream`.
- Headers per request: `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` (for
  tools/call name, resources/read uri, prompts/get name), plus optional `Mcp-Param-{Name}`
  from `x-mcp-header` annotations.
- Notification POST ⇒ server returns `202 Accepted` w/ no body (or 4xx w/ id-less error).
- Request POST ⇒ server returns `application/json` (single object) OR `text/event-stream`
  (SSE stream, request-scoped). Client MUST support both.

### 6.2 Receiving (client)
- SSE stream carries request-scoped notifications (`notifications/progress`,
  `notifications/message`) then the final JSON-RPC response which SHOULD terminate the stream.
- Server MUST NOT send independent JSON-RPC requests on any stream (MRTR instead).
- `subscriptions/listen` returns a long-lived SSE stream delivering opted-in change
  notifications; first frame must be `notifications/subscriptions/acknowledged`.
- `Last-Event-ID`/resumability NOT supported. Keep-alive comments (lines starting `:`) allowed; client MUST ignore.
- `X-Accel-Buffering: no` SHOULD be sent by server.

### 6.3 Header routing / validation (`header-routing.ts`)
- `Mcp-Method` from `method`; `Mcp-Name` from `params.name`/`params.uri`; required.
- Value encoding: Base64 sentinel `=?base64?{...}?=` for non-ASCII/control/whitespace, and
  for any plain value matching the sentinel pattern.
- `x-mcp-header`: parameter schema annotation → `Mcp-Param-{Name}` header. Constraints:
  not empty, field-name token syntax, no CR/LF, unique case-insensitively, primitive types
  only (int/string/bool, not number), statically-reachable via `properties` chain only.
  Client MUST reject invalid tool definitions (exclude from tools/list, log warning).
- Validation mismatch on any header vs body ⇒ HTTP `400` + `-32020` HeaderMismatch.
- Intermediaries that ignore `Mcp-Param-*` MUST forward them.

### 6.4 Sessions
- **No protocol-level sessions, no `Mcp-Session-Id`, no GET stream, no DELETE.** 2026-07-28
  removed all of these from 2025-11-25's Streamable HTTP.
- Server seeing `Mcp-Session-Id`/`Last-Event-ID` should ignore; GET/DELETE ⇒ `405`.

### 6.5 Origin validation
- Server MUST validate `Origin`; invalid ⇒ `403`.

---

## 7. Transport: stdio (`stdio.mdx`)
- Newline-delimited JSON-RPC over stdin/stdout; stderr for logging.
- Server MUST NOT send JSON-RPC requests on stdout (MRTR instead).
- Request metadata inline in `_meta` (no headers).
- Cancellation via `notifications/cancelled`.
- Shutdown: close stdin; escalate SIGTERM→SIGKILL (POSIX) / TerminateProcess/JobObjects
  (Windows).
- Subscription correlation across single channel via `io.modelcontextprotocol/subscriptionId`.
- This project's stdio transport + `LegacyProtocolAdapter` already cover the framing; the
  modern adapter must switch the era logic.

---

## 8. MRTR pattern (`basic/patterns/mrtr.mdx`) — NEW
- `InputRequiredResult`: `{ resultType:"input_required", inputRequests?:InputRequests, requestState?:string }`.
  At least one of `inputRequests`/`requestState` MUST be present.
- `InputRequests`: map `{ key: { method, params } }` where value ∈ Elicit | CreateMessage | ListRoots.
- `InputResponses`: map `{ key: { ...client result } }`.
- Client retry: new JSON-RPC id; echo `requestState` verbatim (MUST NOT inspect/modify);
  add `inputResponses`.
- Server: treat `requestState` as attacker input; integrity-protect if it affects authz.
- Supported on: `prompts/get`, `resources/read`, `tools/call` only.
- Deprecated features `sampling/createMessage` and `roots/list` still surface via MRTR.
- **Elicitation moves into MRTR**: `notifications/elicitation/complete` REMOVED;
  `elicitationId` field REMOVED; server encodes correlation in `requestState`.

---

## 9. Elicitation (`client/elicitation.mdx`)
- Modes: `form` (in-band, schema-limited flat primitive fields) and `url` (out-of-band,
  sensitive data).
- Form requestedSchema restricted: object w/ primitive props (string/number/integer/boolean)
  incl. enums (single/multi-select, titled/untitled); flat only.
- Response actions: `accept` (content), `decline`, `cancel`.
- URL mode: `{ mode:"url", url, message }`; client consent required before opening; response
  `{ action:"accept" }`; outcome learned by retry + `requestState`.
- Server MUST NOT use form mode for secrets; MUST validate URL handling per security section.

---

## 10. Subscriptions (`basic/patterns/subscriptions.mdx`) — NEW (replaces resources/subscribe + GET)
- `subscriptions/listen` params: `notifications: SubscriptionFilter`:
  `{ toolsListChanged?, promptsListChanged?, resourcesListChanged?, resourceSubscriptions?: string[] }`.
- Server MUST ack first w/ `notifications/subscriptions/acknowledged` (id in `_meta`).
- All stream notifications carry `io.modelcontextprotocol/subscriptionId` = request id.
- Graceful closure = empty `subscriptions/listen` result (resultType complete) before close.
- Client cancel (HTTP): close stream. stdio: `notifications/cancelled`.
- Notifications (`notifications/tools/list_changed`, etc.) only if opted in + capability.

---

## 11. Progress (`basic/patterns/progress.mdx`)
- Client opts in via `_meta.progressToken` (string|number, unique).
- Server sends `notifications/progress{ progressToken, progress, total?, message? }`.

---

## 12. Cancellation (`basic/patterns/cancellation.mdx`)
- HTTP: closing response stream = cancel; no `notifications/cancelled`.
- stdio: `notifications/cancelled{ requestId, reason? }`.
- Server `notifications/cancelled` MUST only reference a `subscriptions/listen` id.

---

## 13. Caching (`server/utilities/caching.mdx`) — NEW
- `CacheableResult` fields required (MUST) on complete results of: `server/discover`,
  `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`,
  `resources/read`.
- Fields: `ttlMs` (>=0), `cacheScope` ∈ public|private.
- `input_required` results not cacheable.

---

## 14. Pagination (`server/utilities/pagination.mdx`)
- Opaque cursor; list ops: resources/list, resources/templates/list, prompts/list, tools/list.
- Invalid cursor ⇒ `-32602`.

---

## 15. Logging (`server/utilities/logging.mdx`) — DEPRECATED feature
- Per-request via `_meta.io.modelcontextprotocol/logLevel`; server MUST NOT emit
  `notifications/message` without it.
- Levels: debug..emergency (RFC5424). `notifications/message{ level, logger?, data }`.

---

## 16. Deprecated from 2025-11-25 → 2026-07-28 (authoritative `deprecated.mdx` + `changelog.mdx`)

### 16.1 REMOVED (no longer in spec)
| Feature | Notes |
|---|---|
| `initialize`/`notifications/initialized` handshake | replaced by per-request `_meta` |
| Protocol-level sessions / `Mcp-Session-Id` | stateless |
| HTTP GET stream endpoint | removed |
| `Mcp-Session-Id` lifecycle (incl. DELETE) | removed |
| `ping` | removed |
| `logging/setLevel` | replaced by per-request `logLevel` |
| `notifications/roots/list_changed` | removed |
| `resources/subscribe` / `resources/unsubscribe` | replaced by `subscriptions/listen` |
| `notifications/elicitation/complete`, `elicitationId` | replaced by MRTR `requestState` |
| `tasks/result`, `tasks/list` (in-core experimental) | moved to extension; polling via `tasks/get` + `tasks/update` |
| `Last-Event-ID` / SSE resumability | removed |
| Server-initiated JSON-RPC requests on SSE | replaced by MRTR |
| Error codes `-32001/-32003/-32004` | renumbered to `-32020/-32021/-32022` |
| Resource-not-found `-32002` | now `-32602` (still accept old) |
| URL-elicitation error `-32042` | removed |

### 16.2 DEPRECATED (present but SHOULD NOT adopt; removal no earlier than 2027-07-28)
| Feature | Registry / Migration |
|---|---|
| Roots | pass dirs via tool params / resource URIs / config |
| Sampling | integrate directly with LLM provider APIs |
| Logging | stderr (stdio) / OpenTelemetry |
| Dynamic Client Registration (RFC7591) | Client ID Metadata Documents |
| `includeContext: "thisServer"/"allServers"` | omit or `"none"` |
| HTTP+SSE transport (since 2025-03-26) | Streamable HTTP |

---

## 17. Extensions: Tasks (`docs/extensions/tasks/overview.mdx`)
- Extension id `io.modelcontextprotocol/tasks`. Client declares in `clientCapabilities.extensions`;
  server advertises in `server/discover` capabilities.extensions.
- Server MAY return `CreateTaskResult` (`resultType:"task"`) on a supported request when the
  client declared support. Durable before response.
- Methods: `tasks/get` (poll), `tasks/update` (inputResponses), `tasks/cancel` (cooperative),
  `notifications/tasks` (optional push via subscriptions/listen).
- Statuses: working | input_required | completed | failed | cancelled (last 3 terminal).
- `CreateTaskResult` fields: `taskId`, status, `ttlMs`, `pollIntervalMs`.
- Full spec lives in `modelcontextprotocol/ext-tasks` (fetched separately if needed).

---

## 18. Icons, Annotations, Content types (surface types)
- `Icon{ src, mimeType?, sizes?, theme? }`; client MUST support PNG/JPEG, SHOULD SVG/WebP;
  strict security rules (https|data URIs, same-origin, no credentials, magic-byte check).
- `Annotations{ audience?: ['user'|'assistant'], priority?: number, lastModified?: string }`
  on resources/templates/content blocks.
- Content blocks: `TextContent`, `ImageContent`, `AudioContent`, `ResourceLink`,
  `EmbeddedResource` (server output); plus `ToolUseContent`/`ToolResultContent` (sampling).
- Tools: `outputSchema`, `structuredContent` (any JSON), `annotations`, `icons`, `title`.
- JSON Schema: default 2020-12; MUST support 2020-12; `$ref` network resolution MUST be
  off by default; composition-keyword bounds.

---

## 19. File mapping (map requirement → source file)

### 19.1 New files to create
| Purpose | Proposed path |
|---|---|
| Modern adapter (stateless, per-request `_meta`, discover) | `src/protocols/modern/adapter.ts` |
| `server/discover` request/result parse + version selection | `src/protocols/modern/discover.ts` |
| `_meta` builder (protocolVersion, clientInfo, clientCapabilities, per-request) | `src/protocols/modern/request-meta.ts` |
| MRTR helpers (InputRequiredResult parse, inputResponses echo, requestState) | `src/protocols/modern/mrtr.ts` |
| Result dispatch (resultType complete/input_required/task) | `src/protocols/modern/result.ts` |
| Subscriptions/listen client (open+ack+demux by subscriptionId) | `src/protocols/modern/subscriptions.ts` |
| Modern-era test-suite runner (discover probe, no initialize) | `src/suites/protocol-modern.ts` (or param) |
| Modern HTTP transport mode (no session; Mcp-Method/Mcp-Name/Mcp-Param headers; SSE read) | `src/transports/http/streamable-http-transport.ts` (extend) |

### 19.2 Existing files that must change
| File | Change required |
|---|---|
| `src/core/protocol/factory.ts` | wire `create('modern', ...)` → `createModernProtocolAdapter`; remove the `throw` at factory.ts:40 |
| `src/core/protocol/adapter.ts` | `initialize` semantics for modern → `discover`; NegotiatedSession needs `supportedVersions`; the adapter's `initialize()` should become era-aware (modern: discover + set session) |
| `src/core/protocol/capabilities.ts` | parse `extensions`; `resources.subscribe`; `elicitation.form/url`; keep `roots`/`sampling` as deprecated; add `requiredCapabilities` check for `-32021` |
| `src/core/types/protocol.ts` | already has `2026-07-28` + `modern`; add modern/legacy request-path distinction helpers if needed |
| `src/cli/http.ts` | hardcoded `protocolVersion:'2025-11-25'`, `'legacy'`, `accept:'json'` → allow modern (`--era modern`, `--version 2026-07-28`), pass `protocolVersion:'2026-07-28'` for modern, allow `accept:'sse'`, send required `Mcp-Method`/`Mcp-Name` |
| `src/suites/protocol.ts` | legacy-only (initialize/initialized/duplicate-initialize/pre-initialized-traffic). Modern needs a parallel suite using `server/discover` (no initialize), unsupported-version via `_meta`, header-mismatch, missing-capability. |
| `src/suites/discovery.ts` | validate `resultType==="complete"`; validate `ttlMs`/`cacheScope` on cacheable results; handle `input_required` (MRTR) on tools/call; deterministic-order & `x-mcp-header` rejection checks |
| `src/suites/capability.ts` | `tools/call` result may be `input_required`/`task` — handle MRTR retry; tool-returned `structuredContent`/`outputSchema` validation |
| `src/transports/http/header-routing.ts` | add `Mcp-Name` header building + Base64 sentinel encode/decode + `x-mcp-header`/`Mcp-Param-{Name}` + validation |
| `src/transports/http/streamable-http-transport.ts` | modern mode: no `Mcp-Session-Id`, send `MCP-Protocol-Version` + `Mcp-Method`/`Mcp-Name`, transaction-level SSE response stream handling (progress-notifs + final response), `subscriptions/listen` long-lived stream demux |
| `src/transports/http/sse.ts` | already parses frames; ensure keep-alive comment lines (starting `:`) ignored; used by listen-stream |
| `src/transports/http/client.ts` | `postJson` needs `Accept` both content types + header passthrough (extend `HttpRequestOptions`) |
| `src/core/jsonrpc/messages.ts` | `isNotification`/`isRequest`/`isResponse` already fine; add `resultType` awareness if needed for result handling |
| `src/engine/engine.ts` / `src/engine/ctx.ts` | session population via discover for modern; transport.observer already routes messages to mux (works for SSE dispatch) |
| `src/engine/result.ts` | resolveErrorLayer: MSM caps for new codes `-32020/-32021/-32022` (map to protocol layer, HTTP-400 style) |
| `src/reporting/*` | ReportMeta already includes protocolEra 'legacy' — add 'modern' |
| Tests: `tests/unit/*`, `tests/integration/*` | add modern adapter, discover, MRTR, subscriptions, header-routing, error-code renumber cases |

### 19.3 Blueprint deltas (spec vs `BLUEPRINT.md` Phase 3 description)
1. Blueprint says "start with `server/discover`, `_meta`, MRTR/elicitation" — **correct**, but:
   - "extensions registry + Tasks" ⇒ Tasks is now an **extension** (`io.modelcontextprotocol/tasks`),
     not core; must be negotiated via capabilities, and in `ext-tasks` repo.
   - NO mention that `subscriptions/listen` replaces `resources/subscribe` + HTTP GET — a core,
     REQUIRED-to-consider mechanism (blueprint listed "client features: subscriptions" without
     the new listen-based shape).
   - Blueprint does not reflect removal of `initialize`, sessions, `Mcp-Session-Id`, `ping`,
     `logging/setLevel`, `notifications/roots/list_changed`, SSE resumability.
   - Blueprint lists MRTR & elicitation; spec confirms elicitation moved fully into MRTR and
     REMOVED `notifications/elicitation/complete` + `elicitationId`.
   - Error-code renumbering (`-32020/-32021/-32022`) and reserved-range policy are new.
2. The blueprint's "modern = server/discover, _meta, stateless HTTP" is aligned; the biggest
   gaps are subscriptions/listen, header-routing (`Mcp-Method`/`Mcp-Name`/`x-mcp-header`),
   caching (`ttlMs`/`cacheScope`), and the removed items above.

---

## 20. Verification checklist before implementation (driven from this inventory)
- [ ] `npm run typecheck`, `npx tsc -p tsconfig.test.json`, `npm run lint`, `npm run build`
- [ ] `npm test` — existing 121 stay green; add modern unit/integration tests
- [ ] CLI smoke: `testmymcp http <url> --era modern --version 2026-07-28` over streamable-http
      and stdio; verify no `initialize` sent, discover used, session-free, MRTR handled
- [ ] Confirm all `_meta` required fields present on every modern request
- [ ] Reject header mismatch (-32020), missing capability (-32021), unsupported version (-32022)
- [ ] Cacheable results carry `ttlMs` + `cacheScope`
