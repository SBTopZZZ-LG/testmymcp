# Phase 4 (Behavioral & robustness) — Handoff / Resume Notes

> Status: **ALL PHASE 4 ITEMS IMPLEMENTED & VERIFIED.** New `behavioral` (level 4) and
> `robustness` (level 5) suites run behind `--level`/`maxLevel` and exercise concurrency,
> huge/unicode/binary payload round-trips, cancellation-notification handling, malformed-input
> rejection and recovery, concurrent mixed primitives, concurrency stress, a cursor-pagination
> follow utility, server logging notifications, and graceful shutdown. Full verification chain
> is green (typecheck, lint, build, 212 tests). This file tracks what was built and what is
> intentionally deferred.

---

## 1. What was built

### 1.1 Behavioral suite (`src/suites/behavioral.ts`, level 4)
Uses generic `adapter.request(...)` so it runs identically for both eras and all transports.
Every test tolerantly skips when the required primitive is absent.

- `behavioral concurrency parallel` — 8 parallel `sum` calls with distinct inputs; asserts
  each response matches its request (request-id isolation, no cross-talk).
- `behavioral mux clean` — asserts `adapter.mux.pendingCount === 0` after concurrent use.
- `behavioral payload huge` — round-trips a 256 KiB string through a body-only echo tool.
- `behavioral payload unicode` — round-trips emoji/RTL/multibyte/astral text.
- `behavioral payload binary` — round-trips a base64 encoded blob.
- `behavioral concurrent mixed` — issues `tools/list` + `resources/list` + `prompts/list` +
  a `tools/call` concurrently and verifies all resolve correctly.

Round-trip tool selection (`pickRoundTripTool`) prefers `big_echo` (body-only echo, **no
`x-mcp-header` annotation**) over `delete_file` (legacy fallback that echoes its `path`). This
avoids mirroring a 256 KiB payload into an HTTP header (which would 431).

### 1.2 Robustness suite (`src/suites/robustness.ts`, level 5)
- `robustness cancellation` — sends `notifications/cancelled` for an out-of-band id, then
  verifies the server still responds to `tools/list`.
- `robustness malformed-input` — calls a tool with a type-violating argument and asserts the
  server returns a JSON-RPC `-32602` application error rather than crashing.
- `robustness error-recovery` — verifies a valid call succeeds after a failed one.
- `robustness concurrency-stress` — 16 parallel `sum` calls; all must match and the mux must
  drain to 0.

### 1.3 Pagination utility (`src/suites/pagination.ts`)
- `followListPages(adapter, {method, itemKey, initialParams}, firstResult, timeoutMs, maxPages)`
  follows `nextCursor` to exhaustion, returning `{ items, pages, truncated }`. Handles both the
  modern `resultType` shape and the legacy direct-list shape via `result`/`result.nextCursor`.

### 1.4 Client features (extended in Phase 4)
- **Logging** — the fixture can emit `notifications/logging/message`; a direct transport test
  asserts such server-to-client notifications are captured through `observer.onMessage`
  (`engine-shutdown.test.ts`).
- **Cancellation** (robustness suite), **concurrency**, **pagination** as above.
- Sampling/elicitation (MRTR) and subscriptions/listen were covered in Phase 3.

### 1.5 Graceful shutdown
- `StdioTransport.stop()` ends stdin and waits for a clean exit, escalating to SIGTERM then
  SIGKILL only if the process does not exit (`src/transports/stdio/stdio-transport.ts`).
- `engine-shutdown.test.ts` verifies: (a) a cooperative stdio server exits with code 0 via
  `transport.stop()`; (b) an HTTP client `disconnect()` resolves cleanly after the server is
  killed mid-session (no hang / no throw).

### 1.6 Fixture flags (opt-in, no default tool-list change)
- `tests/fixtures/modern-server.js`: `--paginate` (page-size-1 `tools/list` + `resources/list`
  with `nextCursor`), new `big_echo` tool (body-only echo).
- `tests/fixtures/http-server.js` (legacy HTTP): `--paginate`.
- `tests/fixtures/fake-server.js` (legacy stdio): `--paginate`, `--log-on-call`.

### 1.7 Suite registration (`src/suites/index.ts`)
- `behavioral` at level `4` (category `behavioral`) and `robustness` at level `5` (category
  `robustness`) appended to `SUITES`; `selectSuites(maxLevel)` runs them when
  `--level 4` / `--level 5` (or higher) is requested. Default `maxLevel` stays `Capability` (3),
  so existing default runs are unchanged.

### 1.8 Tests (36 files, 212 tests; +8)
- `tests/integration/engine-behavioral-robustness.test.ts` — suite registration; modern (HTTP,
  level Robustness), legacy (stdio), legacy (HTTP) runs all report 0 fails and exercise the new
  suites; modern `--paginate` pagination follow aggregates all 4 tools across 4 pages.
- `tests/integration/engine-shutdown.test.ts` — graceful shutdown + logging notification.
- Updated `tests/integration/engine-modern.test.ts` tool-list assertion to include `big_echo`.

## 2. Verification
```
npm run typecheck            OK
npm run lint                 OK
npm run build                OK
npm test                     212/212 (36 files)
CLI smoke:
  http --era modern --protocol-version 2026-07-28 --level 5
                             OK  0 fail (behavioral 6/6, robustness 4/4; 262 KiB payload round-trip)
```

## 3. Scope intentionally deferred
These BLUEPRINT Phase 4 areas are not yet implemented (noted for a follow-up pass):
- **Streaming/backpressure measurement** (slow-reader memory/buffering metrics) — the payload
  tests prove fidelity but do not yet measure backpressure/buffering.
- **Progress/streaming tool results** (server-sent progress trailers / incremental results).
- **Roots client-request handling** (adapter answers `roots/list` during MRTR, but no fixture
  exercises a server-side roots capability against it).
- Pagination is honored as a follow-cursor utility, but list **reads** with cursors
  (`resources/read` pagination, `completion` pagination) are not covered.

## 4. Notable behavioral finding
Header-annotated tool parameters (`x-mcp-header`) that carry large or binary values are
mirrored into `Mcp-Param-*` HTTP headers. Sending a 256 KiB value through such a parameter
produces HTTP 431 (`Request Header Fields Too Large`) from Node's HTTP server. The robustness
suite intentionally routes payload round-trips through a body-only echo tool (`big_echo`) to
avoid this footgun, and it is worth calling out to server authors: keep `x-mcp-header`
parameters small.
