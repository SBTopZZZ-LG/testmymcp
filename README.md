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

This package is not published to npm. Install it directly from the Git repository, or run it
on the fly with `npx`.

### Global install (from Git)

```sh
npm install -g SBTopZZZ-LG/testmymcp   # GitHub shorthand; same as github:SBTopZZZ-LG/testmymcp
```

The compiled CLI ships with the repository (so installs don't need a build step) and you get a
ready `testmymcp` command.

> **Windows / npm 10.9.x gotcha:** a global **git-origin** install (`npm install -g user/repo`
> or `npm install -g github:user/repo`, and the `git+…` forms) can fail on this npm version
> even though the repo ships the compiled CLI. npm links the installed package to a volatile
> cache clone that ends up empty, so running `testmymcp` fails with
> `Cannot find module …\dist\cli\index.js`. This is an npm bug, not a packaging one — install a
> **packed tarball** instead, which npm handles registry-style (copies files and dependencies):

> ```sh
> npm pack                                  # creates testmymcp-<version>.tgz
> npm install -g testmymcp-<version>.tgz
> ```

### Download from GitHub Releases

Better still, don't build anything: every tagged release ships a pre-packed
`testmymcp-<version>.tgz`, uploaded by the CI/CD pipeline. It installs registry-style (files and
dependencies copied correctly), so it works on every platform/npm version:

```sh
# latest release
npm install -g https://github.com/SBTopZZZ-LG/testmymcp/releases/latest/download/testmymcp-1.0.0.tgz

# a specific release (URL is pinned to that version's tag)
npm install -g https://github.com/SBTopZZZ-LG/testmymcp/releases/download/v1.0.0/testmymcp-1.0.0.tgz
```

```sh
# or download the tarball and install it locally
curl -L -o testmymcp.tgz https://github.com/SBTopZZZ-LG/testmymcp/releases/latest/download/testmymcp-1.0.0.tgz
npm install -g ./testmymcp.tgz
```

### Run on the fly with npx

Run any command without installing anything:

```sh
# one-shot stdio test
npx -y github:SBTopZZZ-LG/testmymcp stdio "npx some-mcp-server"

# streamable HTTP test
npx -y github:SBTopZZZ-LG/testmymcp http https://example.com/mcp --transport streamable-http
```

`npx` pulls the package from the repo and runs the bundled CLI on each invocation (the first run
is slower while it caches). This is the most reliable way to use the tool.

### From a local clone

```sh
git clone git@github.com:SBTopZZZ-LG/testmymcp.git
cd testmymcp
npm install
npm run build
node dist/cli/index.js --help
```

If you install from a fork, replace `SBTopZZZ-LG` in the `github:` specs with your own
GitHub username/org.

## Skill

The repo ships an agent skill at `skills/testmymcp/SKILL.md` — a detailed cheatsheet for using
this CLI (commands, test levels, sessions, output formats, gotchas). It lives in the repo so it
travels with the code.

### Clone the repo (skill included)

Cloning the repo gives you both the code and the skill:

```sh
git clone git@github.com:SBTopZZZ-LG/testmymcp.git
# the skill is at skills/testmymcp/SKILL.md
```

### Install the skill into your agent's skills directory

To make the skill loadable by your agent, copy (or symlink) the skill folder into your agent's
skills directory. `~/.agents/skills/` is a common, tool-agnostic convention shared by many
agent tools — if your tool uses a different path (e.g. `~/.config/<tool>/skills/`, a
project-local `skills/`, or an editor plugin dir), substitute it below.

```sh
# GitHub — install straight into an agent skills dir
git clone git@github.com:SBTopZZZ-LG/testmymcp.git /tmp/testmymcp
mkdir -p ~/.agents/skills
cp -R /tmp/testmymcp/skills/testmymcp ~/.agents/skills/

# or, if you already have the repo cloned
cp -R skills/testmymcp ~/.agents/skills/
```

Some tools resolve skills from a canonical `~/.agents/skills/` and want a **symlink** from the
tool-specific directory back to the canonical location, so one copy is shared across tools
instead of duplicated:

```sh
# keep a single source of truth in the canonical skills dir, symlink it tool-specifically
ln -s ~/.agents/skills/testmymcp ~/.config/<tool>/skills/testmymcp
```

Each skill is self-contained in its own `<name>/SKILL.md` folder, so more skills can be added
under `skills/` later.

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

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).
