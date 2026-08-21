# AGENTS.md

MCP protocol conformance + interoperability + robustness tester. TypeScript ESM CLI
(`testmymcp` via commander). Covers both protocol eras (Legacy `2024-11-05`→`2025-11-25`,
Modern `2026-07-28`) across stdio / streamable-HTTP / legacy-SSE transports.

## Verify chain (always run these in this order, keep all green)

```
npm run typecheck
npm run lint
npm run build
npm test
```

- `typecheck` = `tsc --noEmit` (strict; also check `tsconfig.test.json` covers tests).
- `lint` = eslint; **fixtures/helpers and fixtures are `.js`, not linted** — only `src/**` and
  `tests/**/*.ts` are linted.
- `test` = `vitest run` (no config; default include). Run one file with
  `npx vitest run tests/integration/engine-modern.test.ts` or filter via `-t "pattern"`.
- `build` emits to `dist/`; the CLI runs from `dist/cli/index.js`, so **the CLI smoke test
  reflects the compiled output** — rebuild after editing `src/`.

## Architecture (non-obvious wiring)

- **Four orthogonal dimensions**: protocol version × lifecycle × transport × primitive/suite.
  Never special-case `(stdio && oldVersion && tools)` — go through the interfaces/factory.
- `src/core/protocol/factory.ts` `create(eraOrVersion, opts)` returns a `LegacyProtocolAdapter`
  or `ModernProtocolAdapter` — the engine never `new`s concrete adapters directly.
- `src/suites/index.ts` `SUITES` is ordered by `TestLevel` (0 connectivity → 5 robustness);
  `selectSuites(maxLevel)` gates which run. The engine runs `connect()` once, then suites.
- **`maxLevel` default is `Capability` (3)** in `defaultRunOptions` (`src/engine/options.ts`).
  Behavioral (4) and robustness (5) suites only run with `--level 4|5` / `maxLevel` ≥ that.
- Transport/observer plumbing: the engine wires `transport.observer.onMessage` →
  `adapter.mux.handleMessage(message)`; the multiplexer correlates by id (never assume
  response order == request order).

## Key gotchas

- **Unhappy-path results depend on suite early-return logic**: e.g. `connectivity.ts` fails
  `connect spawn` on premature exit; `protocol.ts` returns early (just `protocol process-alive`)
  if the process already exited, and pushes `protocol remaining-skipped` if initialize fails.
  When adding a new failure fixture, verify actual result ids with a probe before encoding the
  manifest (see `tests/e2e/`).
- **`isResponse` requires exactly one of `result`/`error`** (`src/core/jsonrpc/messages.ts`); a
  frame with both (or neither) is ignored → request times out (bounded, not a hang). Emitting a
  garbage line makes the client record `connect stdout-garbage` / `protocol stdout-framing`.
  An **oversize line** (over `maxLineBytes`) cannot be framed: `engine.onOversize` now fails all
  pending multiplexer requests immediately with a byte-count error (per-test failure, no hang),
  and a global `/hang`-style overall timeout **preserves already-collected results** — it appends
  `engine overall-timeout` instead of discarding the suite output. Default `maxLineBytes` is
  16 MiB (1 MiB historically); update all three defaults together (runner + `cli/index.ts` +
  `cli/session.ts`, all `16777216`).
- **`x-mcp-header` annotated params are mirrored into `Mcp-Param-*` HTTP headers**; a large value
  through such a param yields HTTP 431. For payload round-trips use a body-only echo tool
  (`big_echo`), never a header-annotated param.
- Modern headers must carry `version: MODERN_VERSION`, not the legacy default; the fixture
  helpers default to legacy (`tests/fixtures/helpers/http.js`).
- **Distribution: global git-origin installs are broken on npm 10.9.x/Windows.** `npm install -g
user/repo`, `github:user/repo` and `git+…` forms link the package to a volatile
  `npm-cache\_cacache\tmp\git-clone*` (junction) that resolves empty → `testmymcp` fails with
  `MODULE_NOT_FOUND` for `dist/cli/index.js`. Reproduced even from a local `git+file:` URL.
  Registry-style installs work: `npm pack` then `npm install -g testmymcp-<version>.tgz`;
  `npx -y github:SBTopZZZ-LG/testmymcp …` also works (runs from the `_npx` cache).

## Test layout / E2E

- `tests/unit`, `tests/integration`, `tests/e2e`, `tests/fixtures`.
- `tests/fixtures/helpers/http.js|stdio.js` are shared ESM building blocks; unhappy fixtures live
  in `tests/fixtures/unhappy/` (one behavior per fixture, each ~20–60 lines).
- `tests/e2e/manifest/scenarios.json` is the **declare-once coverage contract**: scenario →
  fixture, era, transport, options, per-test-id expected status with `required: true|false`,
  plus `noHang` / `transportHeaderIssues` / `transportSessionId` invariants.
  `tests/e2e/run-scenario.ts` + `scenarios.test.ts` run the engine against each and diff.
- Windows CI is intentionally commented out (`verify-windows` in `.github/workflows/ci.yml`).

## Conventions

- **Git: conventional commits** (e.g. `feat:`, `test(e2e):`, `ci:`, `chore:`).
- Only `BLUEPRINT.md` is tracked among planning docs; `ACCOUNT_FOR.md`, `PHASE*-HANDOFF.md`,
  `PHASE3-SPEC-INVENTORY.md` are gitignored (stay local).
- Omit explanatory comments unless asked.
