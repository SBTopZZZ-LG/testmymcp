---
name: testmymcp
description: |
  How to use the `testmymcp` CLI — a protocol conformance, interoperability and
  robustness tester for MCP servers. Covers both protocol eras (Legacy
  2024-11-05→2025-11-25, Modern 2026-07-28) across stdio / streamable-HTTP /
  legacy-SSE transports: one-shot runs, persistent sessions, test levels,
  JSON/terminal reporting, exit codes, and common usage patterns.
  Use when testing or validating an MCP server, debugging a server's protocol
  conformance, or wiring conformance checks into a pipeline.
  Trigger keywords: testmymcp, MCP conformance, test an MCP server, mcp stdio,
  mcp http, session create, protocol version, MCP-Protocol-Version, tool auto-invoke.
---

# testmymcp — MCP conformance tester (cheatsheet + usage)

`testmymcp` drives a real MCP handshake and method calls against a server and reports
per-test pass / warn / fail with the failure **layer**. It supports both protocol eras and all
three transports, and is **safe by default** when auto-invoking tools.

## CLI surface

Run `testmymcp --help` and `testmymcp <command> --help` for the authoritative list.

| Command                                | Purpose                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------- |
| `stdio <command>`                      | Test a stdio MCP server (command string, e.g. `"npx x"`, `"uvx x"`).       |
| `http <url>`                           | Test over streamable HTTP or legacy SSE (`--transport`).                   |
| `session create/list/show/dispose <…>` | Manage persistent, reusable sessions.                                      |
| `test <id>`                            | Run the suites against a persisted session (reconnect from stored config). |
| `inspect <file>`                       | Render a saved trace JSON.                                                 |
| `scan <url>`                           | Security/agent-safety scanner — **not yet implemented** (returns exit 2).  |

## Install / run

Not published to npm. Run on the fly or install from git:

```sh
# one-shot via npx (no install)
npx -y github:SBTopZZZ-LG/testmymcp --help

# global install from git
npm install -g github:SBTopZZZ-LG/testmymcp

# from a local clone
git clone git@github.com:SBTopZZZ-LG/testmymcp.git && cd testmymcp
npm install && npm run build
node dist/cli/index.js --help
```

`dist/` is committed, so git/npx installs work with no build-on-install step. On some
Windows/npm versions a global `-g git+…` install fails to unpack; use the `npx` form there.

## Test levels (0–7)

`--level <n>` runs every suite at or below `n`. Default is **3** (`Capability`).

| Level | Suite           | What it checks                                                                                                            |
| ----- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 0     | connectivity    | spawn, stdout framing, stderr capture, premature-exit detection                                                           |
| 1     | protocol        | initialize/version negotiation, server info, capabilities, duplicate-initialize, unsupported-version, framing             |
| 2     | discovery       | tools / resources / prompts / completion list + schema, caching hints                                                     |
| 3     | capability      | tools/call, resources/read, prompts/get                                                                                   |
| 4     | behavioral      | request-id-isolated concurrency, payload round-trips, cancellation, malformed-input recovery, concurrent mixed primitives |
| 5     | robustness      | concurrency stress, pagination-follow, server logging notifications, graceful shutdown                                    |
| 6–7   | security / fuzz | planned future tiers (`scan`, fuzzing)                                                                                    |

`--level 4` / `--level 5` opt into behavioral & robustness. Fuzzing (`scan`, level ≥6) is not
implemented yet.

## Tool auto-invoke safety

`--mode <mode>` (default `safe`):

- `safe` — auto-invoke only tools classified safe/readonly; everything else is skipped (`–`).
- `readonly` — invoke tools the classifier marks non-destructive.
- `all` — invoke every tool (destructive ones included).

Plane-style CRUD tools (`project create`, `workitem delete`, …) do not pass the safe classifier,
so they appear as `–` (skipped) under the default. Raise `--mode all` only when you explicitly
want to exercise mutating tools.

## One-shot runs

```sh
# stdio
testmymcp stdio "npx some-mcp-server"
testmymcp stdio "uvx some-mcp-server" --level 5

# streamable HTTP with bearer token
testmymcp http https://example.com/mcp --transport streamable-http --token <token>

# legacy SSE
testmymcp http https://example.com/sse --transport legacy-sse

# modern era, prefer a specific protocol version
testmymcp stdio "npx some-modern-server" --era modern --protocol-version 2026-07-28
```

### Env-configured stdio servers

Pass env directly with repeatable `--env KEY=VALUE` (merged over the current environment):

```sh
testmymcp stdio "uvx plane-mcp-server stdio" \
  --env PLANE_API_KEY=... \
  --env PLANE_BASE_URL=http://localhost:30100 \
  --env PLANE_WORKSPACE_SLUG=default
```

## Persistent sessions

Sessions persist a redacted connection config in `.testmymcp/sessions.json`. **Bearer tokens and
secret-looking env values are never written to disk** — only the auth mode and a
`requiresToken` / `requiresSecretEnv` flag. `session create` validates the connection (full
initialize) before persisting.

```sh
# create + validate + persist (prints a stable id like stdio-9eaf725f9c)
testmymcp session create "uvx some-server" --transport stdio --name dev \
  --env SOME_API_KEY=...

testmymcp session create https://example.com/mcp --transport streamable-http \
  --name prod --token <token>

# inspect (credentials redacted)
testmymcp session list
testmymcp session show dev

# run the suites against a persisted session
testmymcp test dev
testmymcp test dev --level 5

# re-supply a token or secret env the session requires
testmymcp test dev --token <token>
testmymcp test dev --env SOME_API_KEY=...

# remove it
testmymcp session dispose dev
testmymcp session dispose stdio-9eaf725f9c   # also works by id
```

Session ids derive from a hash of the sanitized config — the **token value does not change the
id** (auth mode does). Session ids are prefixed `stdio-` / `http-`. `session list` / `dispose`
accept either the id or the `--name` alias.

"Reuse" means reconnecting from the persisted config, not holding a live socket across commands
(that would require a daemon).

## Output

### Terminal (default)

```
Protocol 2025-11-25 (legacy)   Transport stdio   Server fake-mcp-server 1.0.0
 ✓ connect spawn                                                       153ms
 ✓ protocol initialize                                                 2.06s
 ⚠ protocol unsupported-version    server did not reject an unknown protocol version   1ms
 – tools/call project                                                                   0ms

Failure layers
  transport      0
  jsonrpc        0
  protocol       0
  application    0

Verdict: WARN  13 pass, 0 fail, 6 warn, 31 skip
```

Markers: `✓` pass, `⚠` warn, `–` skip, `✗` fail. The verdict line prints `PASS` / `WARN` / `FAIL`
with the pass/fail/warn/skip counts. `scan` and unimplemented paths print to stderr and exit 2.

### JSON (`--json`)

```sh
testmymcp stdio "npx s" --json
```

Top-level keys: `tool`, `schemaVersion`, `meta`, `summary`, `tests`, `errors`, `warnings`.

- `meta` — `protocol`, `protocolEra` (`legacy`/`modern`), `transport`, `startedAt`, `durationMs`,
  `command` (url or command), `serverName`, `serverVersion`.
- `summary` — `total/pass/fail/warn/skip`, `byLayer` (`transport/jsonrpc/protocol/application`),
  `byCategory`, `byStatus`.
- `tests[]` — `id`, `category`, `level`, `status`, `severity`, `durationMs`, `transport`, plus
  failure detail on fails.

**Compact mode for CI/agents:** add `--json-summary` to drop the embedded per-test payloads
(`evidence`/`request`/`response`) — the fields that balloon the report when a tool returns
multi-MB results — while keeping status, layer, error, warnings, and `summary`. Available on
`stdio`, `http` and `test`:

```sh
testmymcp stdio "npx s" --json --json-summary
```

## Exit codes

- `0` — no failures.
- `1` — at least one test failed.
- `2` — usage / connection / configuration error, or unimplemented command (`scan`).

Programmatic use: `--json` + the exit code is the machine interface (for AI agents / CI).

## Result id conventions (for manifest/assertion work)

Suite ids are `<suite> <name>`, e.g. `protocol initialize`, `connect spawn`, `tools/list`. The
e2e harness (`tests/e2e/manifest/scenarios.json`) declares per-scenario expected statuses with
`required: true|false`. When adding failure fixtures: a crash can surface at `connect spawn`
(settle-window) **or** `protocol initialize` (child exits after connect), so assert the invariant
("no session + a failure reported"), not a single id.

## Non-obvious behavior / gotchas

- On transport exit, in-flight requests are failed **fast** (`mux.failAll`), not left to hang the
  timeout — a dead server can never respond.
- `isResponse` requires exactly one of `result`/`error`; a frame with both is ignored (request
  times out, bounded).
- `x-mcp-header` annotated params mirror into `Mcp-Param-*` HTTP headers; a large value through
  one yields HTTP 431 — use a body-only `big_echo` tool for large payload round-trips.
- Modern servers must return `MCP-Protocol-Version: 2026-07-28` (not the legacy default) or
  header routing fails.
- A server response line over the configured cap (`--max-line-size`, default 16 MiB) cannot be
  framed: pending requests fail **fast** as per-test transport errors carrying the byte count —
  a bounded failure, not a hang. If a tool legitimately returns multi-MB results (e.g. a symbol
  table), raise `--max-line-size`; use `--json-summary` so the payload doesn't bloat the report.

## Development

Verify chain (enforced on commit by the pre-commit hook and in CI):

```sh
npm run format:check && npm run typecheck && npm run lint && npm run build && npm test
```

- `format` / `format:check` — Prettier (incl. markdown) + import sorting.
- `lint` — eslint (notes: fixtures `.js` are not linted; complexity rules are disabled).
- `test` — `vitest run`; single file `npx vitest run tests/integration/engine-stdio.test.ts`.
- `build` — emits `dist/`; the CLI runs from `dist/cli/index.js`.
