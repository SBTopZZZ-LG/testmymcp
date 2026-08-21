# testmymcp

A protocol conformance, interoperability and robustness tester for
[Model Context Protocol](https://modelcontextprotocol.io) (MCP) servers. It drives a real MCP
handshake and method calls across both protocol eras and all supported transports, and reports
pass / warn / fail per test with the failure layer.

- **Protocol eras** — Legacy (`2024-11-05` → `2025-11-25`) and Modern (`2026-07-28`).
- **Transports** — stdio, streamable HTTP, and legacy SSE.
- **Test levels 0–7** — connectivity → protocol → discovery → capability → behavioral →
  robustness → fuzzing. Levels 4–5 are opt-in; fuzzing (7) is a future tier.
- **Safe by default** — tool auto-invocation runs only `safe`/`readonly` tools unless you raise
  `--mode`.

## Install

```sh
npm install -g testmymcp
```

Or run straight from the repo with the compiled CLI:

```sh
npm install
npm run build
node dist/cli/index.js --help
```

## Usage

### One-shot run

```sh
# stdio server
testmymcp stdio "npx some-mcp-server"

# streamable HTTP (bearer token)
testmymcp http https://example.com/mcp --transport streamable-http --token <token>

# legacy SSE
testmymcp http https://example.com/sse --transport legacy-sse

# Modern protocol era
testmymcp stdio "npx some-modern-server" --era modern
```

Env-configured stdio servers (API keys, base URLs) pass variables directly:

```sh
testmymcp stdio "uvx some-server" \
  --env SOME_API_KEY=... \
  --env SOME_BASE_URL=...
```

### Persistent sessions

Reuse a connection instead of re-running from scratch each time. Persistent sessions are stored
in `.testmymcp/sessions.json`; bearer tokens and secret env values are never written to disk.

```sh
# create (validates the connection first)
testmymcp session create "npx some-mcp-server" --transport stdio --name dev

# create an HTTP session with an env-configured stdio server
testmymcp session create "uvx some-http-server" \
  --env SOME_API_KEY=... \
  --env SOME_BASE_URL=...

# list and inspect (credentials redacted)
testmymcp session list
testmymcp session show dev

# run the suites against the persisted session
testmymcp test dev --level 5

# remove it
testmymcp session dispose dev
```

If a session requires a bearer token or a secret env value, supply it on `test`:

```sh
testmymcp test dev --token <token>
testmymcp test dev --env SOME_API_KEY=...
```

### Inspect a saved trace

```sh
testmymcp inspect trace.json
```

## Command reference

| Command                   | Description                                                           |
| ------------------------- | --------------------------------------------------------------------- |
| `stdio <command>`         | Test an MCP server over stdio.                                        |
| `http <url>`              | Test an MCP server over streamable HTTP or legacy SSE.                |
| `session create <target>` | Connect to a server and persist it as a reusable session.             |
| `session list`            | List persisted sessions.                                              |
| `session show <id>`       | Show session details (credentials redacted).                          |
| `session dispose <id>`    | Remove a session and its stored credential.                           |
| `test <id>`               | Run the conformance suites against a persisted session.               |
| `inspect <file>`          | Render a saved trace file.                                            |
| `scan <url>`              | Security / agent-safety scan (**not yet implemented** — ships later). |

### Shared options

| Option                         | Applies to                  | Description                                                        |
| ------------------------------ | --------------------------- | ------------------------------------------------------------------ |
| `--mode <mode>`                | stdio, http, test           | Tool execution policy: `safe`, `readonly`, `all` (default `safe`). |
| `--level <n>`                  | stdio, http, test           | Highest test level to run, 0–7 (default `3`).                      |
| `--json`                       | stdio, http, test           | Emit a machine-readable JSON report.                               |
| `--timeout <ms>`               | all                         | Per-request / overall timeout (default `30000`).                   |
| `--token <token>`              | http, session create, test  | Bearer token for `Authorization`.                                  |
| `--env <key=value>`            | stdio, session create, test | Env var for a stdio server child (repeatable).                     |
| `--era <era>`                  | stdio, http, session create | Protocol era: `legacy` or `modern`.                                |
| `--protocol-version <version>` | stdio, http, session create | Preferred protocol version.                                        |
| `--show-secrets`               | stdio, http, test           | Disable redaction of sensitive values in traces.                   |

Run `testmymcp <command> --help` for the full option list.

## Exit codes

- `0` — no failures.
- `1` — at least one test failed.
- `2` — usage / connection / configuration error.

## Development

```sh
npm install
npm run format        # prettier (incl. markdown) + import sorting
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
npm run build         # compile to dist/
npm test              # vitest run
```

Run the same verify chain all at once when making changes (also enforced on commit by the
pre-commit hook):

```
npm run format:check && npm run typecheck && npm run lint && npm run build && npm test
```

## License

MIT
