Yeah, Saumitra. And there’s a **very important wrinkle** right now: `testmymcp` cannot treat MCP as one static protocol.

As of **August 2026**, there are effectively two protocol eras you need to account for:

* **Legacy era:** `2024-11-05`, `2025-03-26`, `2025-06-18`, `2025-11-25`
* **Modern era:** `2026-07-28`

The 2026-07-28 revision is a substantial wire-protocol change: it removes the `initialize` handshake and protocol-level sessions, introduces `server/discover`, moves request metadata into `_meta`, makes Streamable HTTP stateless by default, adds multi-round-trip requests, header-based routing, and formalizes extensions. ([Model Context Protocol Blog][1])

So I'd design `testmymcp` as a **protocol conformance + interoperability + robustness tester**, rather than merely an MCP client.

---

# `testmymcp` — what it should account for

## 1. Protocol/version detection

This should be one of your first components.

### Known protocol revisions

| Version      | Era    | Important distinction                              |
| ------------ | ------ | -------------------------------------------------- |
| `2024-11-05` | Legacy | Original lifecycle/HTTP+SSE world                  |
| `2025-03-26` | Legacy | OAuth, Streamable HTTP, batching, tool annotations |
| `2025-06-18` | Legacy | Further protocol evolution                         |
| `2025-11-25` | Legacy | Latest pre-2026 protocol; Tasks appeared           |
| `2026-07-28` | Modern | Stateless core, no initialize/session              |

The currently recognized released versions are these five. ([MCP Python SDK][2])

### Your tester should determine

* What protocol version does the server claim to support?
* Does it support multiple versions?
* Does version negotiation work?
* Does it correctly reject unsupported versions?
* Does it behave consistently after negotiation?
* Does it accidentally use methods/features from another version?
* Does it gracefully downgrade?
* Does it incorrectly assume date strings are numerically ordered?

That last one is subtle: protocol versions are **enumerated identifiers**, not arbitrary semantic versions. ([MCP Python SDK][2])

---

# 2. Two completely different lifecycle models

This is probably the biggest architectural issue for your implementation.

## Legacy lifecycle

```text
connect transport
      ↓
initialize
      ↓
initialize response
      ↓
initialized notification
      ↓
normal operation
      ↓
shutdown
```

The server advertises:

* protocol version
* server implementation info
* capabilities

The client advertises:

* protocol version
* client implementation info
* client capabilities

Then `initialized` marks the transition into normal operation. ([Model Context Protocol][3])

### Test cases

You should deliberately test:

* initialize succeeds
* initialize with supported version
* initialize with unsupported version
* malformed initialize
* missing capabilities
* missing clientInfo
* malformed server response
* initialize timeout
* sending normal requests before `initialized`
* duplicate initialize
* duplicate initialized
* requests after shutdown
* server disconnect during initialization

---

## Modern lifecycle (`2026-07-28`)

There is **no initialize handshake**.

Instead, requests are self-describing and carry things such as:

```text
protocol version
client identity
client capabilities
```

inside request metadata.

A client may optionally call:

```text
server/discover
```

to learn capabilities up front. ([Model Context Protocol Blog][1])

So your engine should conceptually have:

```text
ProtocolAdapter
 ├── LegacyProtocolAdapter
 └── ModernProtocolAdapter
```

rather than stuffing version checks throughout the code.

That architectural decision will save you pain later.

---

# 3. Transport matrix

Officially, modern MCP has:

* **stdio**
* **Streamable HTTP**

The older HTTP+SSE transport is a **legacy transport** that you should still support for compatibility testing. ([Model Context Protocol][4])

So:

```text
                 MCP
                  │
       ┌──────────┴──────────┐
       │                     │
     stdio                HTTP
                             │
                 ┌───────────┴───────────┐
                 │                       │
          Streamable HTTP          legacy SSE
```

---

# 4. stdio testing

This deserves much more attention than it initially appears.

The protocol is newline-delimited JSON-RPC over:

```text
stdin → server
stdout ← server
```

Messages must be newline-delimited and must not contain embedded newlines. `stderr` can be used for logging. ([Model Context Protocol][4])

### Test

#### Process

* command exists
* executable permissions
* spawn failure
* incorrect working directory
* environment variables
* inherited environment
* custom environment
* arguments
* shell vs direct execution
* Windows `.cmd` / `.exe`
* Unix executables
* process exits immediately
* process crashes
* process hangs
* process leaks child processes

#### stdout

Absolutely critical:

* valid JSON
* valid JSON-RPC
* one message per line
* no random stdout logging
* no banners
* no startup messages
* no ANSI garbage
* no debug output
* UTF-8 correctness
* partial lines
* multiple responses arriving together
* notifications mixed with responses

A server that writes:

```text
Starting server...
{"jsonrpc":"2.0",...}
```

to stdout is broken from a protocol perspective.

Your tool should detect this explicitly.

#### stderr

Capture separately:

```text
stdout → protocol
stderr → diagnostics
```

Record:

* log lines
* timestamps
* process exit
* crash output
* stack traces

This is one of the most valuable debugging features of `testmymcp`.

---

# 5. Streamable HTTP testing

This is probably your largest transport subsystem.

You'll need to test:

### HTTP basics

* URL
* HTTP method
* status codes
* headers
* redirects
* TLS
* certificate failures
* proxy behavior
* connection timeout
* read timeout
* request timeout
* keep-alive
* connection reuse

### MCP headers

For modern Streamable HTTP, you'll need to understand things such as:

```http
MCP-Protocol-Version
Mcp-Method
Mcp-Name
```

and validate their relationship with the JSON-RPC body. The 2026 protocol explicitly introduces header-based routing and validation. ([Model Context Protocol Blog][1])

Your tester should therefore detect:

```text
body method != Mcp-Method
body tool != Mcp-Name
protocol header != request metadata
missing required headers
invalid headers
malformed values
```

---

# 6. Legacy Streamable HTTP sessions

For legacy protocol versions, you need to understand:

```http
MCP-Session-Id
```

and session lifecycle.

Test:

* session creation
* session persistence
* missing session ID
* wrong session ID
* expired session
* session termination
* HTTP 404 after session invalidation
* reconnect behavior
* session reuse
* concurrent requests
* server restarts
* session affinity

The legacy transport explicitly uses protocol-version headers and session behavior. ([Model Context Protocol][4])

Modern 2026 MCP removes this protocol-level session mechanism. ([Model Context Protocol Blog][1])

---

# 7. SSE / streaming behavior

Don't merely assume:

```text
HTTP response → JSON
```

You need to understand:

```text
JSON
SSE
stream chunks
notifications
multiple messages
connection termination
```

Streamable HTTP can return:

* direct JSON
* streamed SSE responses

and stateful implementations can provide server-to-client streams. ([Model Context Protocol][5])

Your parser should therefore handle:

```text
HTTP
 └─ content-type
      ├─ application/json
      └─ text/event-stream
```

and report:

* first byte latency
* first MCP message latency
* message boundaries
* malformed SSE
* stream closure
* premature disconnect
* graceful completion
* reconnect/resumption where applicable

---

# 8. JSON-RPC correctness

This should almost be its own test suite.

Every MCP message ultimately relies on JSON-RPC.

Test:

### Requests

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "...",
  "params": {}
}
```

### Responses

Check:

* matching ID
* result XOR error
* valid error structure
* integer error code
* unique IDs
* ordering
* unknown IDs
* duplicate IDs

### Notifications

Ensure:

```text
notification != request
notification != response
notification has no ID
```

The underlying MCP JSON-RPC requirements explicitly cover these rules. ([Model Context Protocol][6])

### Malformed protocol tests

You can intentionally send things like:

* invalid JSON
* invalid `jsonrpc`
* missing method
* null ID
* duplicate IDs
* invalid params
* response with wrong ID
* response containing result + error
* invalid notification
* unknown method

That makes `testmymcp` useful as a **server fuzz/conformance tester**, not just a smoke tester.

---

# 9. Server capabilities

Build a capability matrix.

Legacy capability families include:

```text
tools
resources
prompts
logging
experimental
```

Client-side:

```text
roots
sampling
elicitation
experimental
```

The exact availability and lifecycle changes across protocol revisions, so your capability engine should be version-aware. ([Model Context Protocol][3])

---

# 10. Tools

This will probably be the star of the CLI.

Test:

```text
tools/list
tools/call
```

For every tool:

```text
name
description
inputSchema
outputSchema
annotations
_meta
```

### `tools/list`

Test:

* empty catalog
* one tool
* hundreds/thousands of tools
* pagination
* `nextCursor`
* invalid cursor
* duplicate names
* strange names
* missing description
* malformed schema
* list change notifications

Pagination cursors are opaque and must not be interpreted by clients. ([Model Context Protocol][7])

---

# 11. Tool schema validation

This is where `testmymcp` can become extremely useful.

For every tool:

### Input schema

Generate test cases:

```text
minimum valid input
empty object
missing required fields
wrong types
additional properties
null
arrays
nested structures
enum violations
oneOf
anyOf
allOf
$ref
$defs
```

The 2026 spec moved tools toward full **JSON Schema 2020-12**, including composition and references. ([Model Context Protocol Blog][8])

So don't build your validator around:

```js
type: "object",
properties: {}
```

only.

---

# 12. Automatically invoking tools

This is one of the coolest possibilities.

For a tool:

```text
calculate_sum
{
  a: integer,
  b: integer
}
```

the tester could automatically generate:

```text
1 + 2
0 + 0
-1 + 1
large integers
invalid type
missing a
missing b
extra fields
null
```

But this requires **safety classification**.

Don't blindly execute:

```text
deleteDatabase()
sendEmail()
transferMoney()
deployProduction()
```

Your CLI should support execution policies such as:

```text
--mode=safe
--mode=readonly
--mode=all
--confirm-destructive
```

---

# 13. Tool results

A tool result can contain more than just text.

Your parser should understand content variants such as:

```text
text
image
audio
embedded resource
resource link/reference
structured content
```

The tool result also has the distinction between:

```text
protocol error
```

and:

```text
result.isError === true
```

That distinction is extremely important.

A tool can successfully execute at the MCP protocol level while reporting an application failure through its result. ([Model Context Protocol][9])

Your report should therefore say something like:

```text
Transport: PASS
JSON-RPC: PASS
MCP request: PASS
Tool execution: FAIL
Failure type: application/tool error
```

rather than simply:

```text
❌ tools/call failed
```

---

# 14. Tool streaming / progress

This is the part you specifically mentioned.

Don't assume:

```text
tools/call → one response
```

You need to handle:

```text
request
  ↓
progress notification
  ↓
progress notification
  ↓
log message
  ↓
more progress
  ↓
final response
```

Test:

```text
progressToken
notifications/progress
progress
total
message
```

Record:

```text
T0 request sent
T1 first progress
T2 second progress
T3 final response
```

Then provide something like:

```text
Tool duration: 12.42s
Progress events: 7
First progress: 0.31s
Final result: 12.42s
```

That's **much** more useful than a raw transcript.

---

# 15. Cancellation

You need cancellation testing.

Test:

```text
start long-running tool
        ↓
wait 500ms
        ↓
cancel
        ↓
verify server stops work
```

Check:

* cancellation notification
* cancellation timing
* server behavior
* response after cancellation
* transport behavior
* leaked work after cancellation

The cancellation mechanism differs between protocol generations; the modern Streamable HTTP model uses stream closure for client cancellation rather than the older mechanism. ([Model Context Protocol][10])

---

# 16. Ping / liveness

Test protocol liveness.

Things like:

```text
ping
```

and determine:

```text
server alive?
latency?
responding?
transport alive?
```

Also test whether the server stops responding while the underlying transport remains open.

---

# 17. Resources

Don't forget MCP is not just tools.

Test:

```text
resources/list
resources/read
resources/templates/list
```

Potential resource forms:

```text
file://
https://
custom://
```

Test:

* listing
* pagination
* URI validity
* reading
* nonexistent URI
* MIME type
* text content
* binary/blob content
* resource references
* subscriptions
* resource updates
* list changed notifications

---

# 18. Resource templates

A server may expose something conceptually like:

```text
github://repo/{owner}/{repo}/issue/{number}
```

Your tester should:

1. discover templates
2. understand URI templates
3. generate valid examples
4. resolve them
5. attempt invalid substitutions

This is an easy feature to forget.

---

# 19. Resource subscriptions

Legacy MCP supports resource subscriptions.

Test:

```text
subscribe
resource changes
notification
unsubscribe
```

Then verify that:

```text
resource changed
```

actually produces the appropriate notification.

Modern MCP changes the notification/subscription architecture; the 2026 era introduces `subscriptions/listen`. ([Model Context Protocol][10])

Again: **version-specific test adapter.**

---

# 20. Prompts

Test:

```text
prompts/list
prompts/get
```

For each prompt:

* name
* description
* arguments
* required arguments
* optional arguments
* missing arguments
* invalid arguments
* generated messages
* content types
* embedded resources

Also test pagination and list-change behavior.

---

# 21. Completions

MCP can provide argument completion for:

* prompts
* resource URIs

Test:

```text
completion/complete
```

with:

* empty input
* partial input
* nonsense input
* long input
* unicode
* more than 100 suggestions
* `hasMore`
* `total`

The completion protocol caps returned suggestions at 100. ([Model Context Protocol][11])

---

# 22. Sampling

This one gets spicy.

An MCP server can ask the client to perform an LLM sampling operation.

So the server isn't just:

```text
client → server
```

It can become:

```text
client → server
server → client
client → LLM
client → server
server → client
```

Your testing client needs to be able to **mock** this.

You don't want `testmymcp` suddenly burning someone's OpenAI credits because a server asked for sampling.

Provide:

```text
sampling policy
  ├── deny
  ├── mock
  └── real
```

Sampling is now deprecated in the 2026-07-28 lifecycle, but the methods/capabilities remain supported during the deprecation window, so a compatibility tester absolutely should still understand them. ([Model Context Protocol Blog][8])

---

# 23. Elicitation

Same principle.

A server may require user input.

Legacy:

```text
server → client
elicitation/create
```

Modern:

```text
server → input_required
client answers
client retries / continues request
```

This is part of the new **Multi Round-Trip Request (MRTR)** mechanism. ([Model Context Protocol Blog][1])

Your CLI is non-interactive, so this becomes interesting.

You could support:

```bash
testmymcp ... --elicitation=reject
testmymcp ... --elicitation=auto
testmymcp ... --elicitation=input.json
```

That makes automated CI possible.

---

# 24. Roots

Legacy MCP clients can expose filesystem roots to servers.

Test:

```text
roots/list
```

and:

* no roots
* one root
* multiple roots
* invalid URI
* changed roots
* notification

Again, roots are deprecated in the modern lifecycle, but remain relevant for older servers. ([Model Context Protocol Blog][8])

---

# 25. Logging

There are multiple layers here.

You should differentiate:

```text
transport logs
server stderr
MCP logging notifications
tool output
CLI diagnostics
```

Legacy MCP supports structured logging through logging messages.

Modern 2026 deprecates MCP logging in favor of stderr/OpenTelemetry, but compatibility testing still needs to recognize it. ([Model Context Protocol Blog][8])

Your output could look like:

```text
[transport] POST /mcp
[mcp/log] level=info message="starting operation"
[progress] 20%
[progress] 60%
[tool] completed
```

That'd be insanely useful.

---

# 26. Pagination

This should be implemented as a generic utility.

Any list operation that supports pagination should be tested through:

```text
page 1
 ↓
nextCursor
 ↓
page 2
 ↓
...
```

Test:

* normal pagination
* no pagination
* empty page
* repeated cursor
* invalid cursor
* cursor causes infinite loop
* duplicated items across pages
* ordering changes
* huge page count

And enforce a maximum page count so a broken server can't trap your CLI forever. ([Model Context Protocol][7])

---

# 27. Modern MCP Tasks

This is another big one.

Tasks let a tool call return:

```text
task handle
```

instead of the final result.

Then:

```text
tasks/get
tasks/update
tasks/cancel
```

drive the task lifecycle.

The current Tasks extension is explicitly designed for long-running work and polling. ([MCP Tasks Extension][12])

Your tester should test:

```text
tool call
 ↓
resultType=task
 ↓
poll
 ↓
working
 ↓
working
 ↓
input_required
 ↓
...
 ↓
complete
```

And detect:

* task never completes
* task disappears
* invalid task ID
* TTL expiry
* wrong polling interval
* cancellation
* malformed task state
* duplicate task IDs
* task result mismatch

This deserves its own subsystem.

---

# 28. Extensions

Modern MCP introduces a formal extension mechanism.

Your architecture should **not** assume:

```text
capability == built-in MCP feature
```

Instead:

```text
core protocol
      +
extensions
```

Examples already around the ecosystem include:

* Tasks
* MCP Apps
* Enterprise Managed Authorization

The 2026 protocol explicitly formalizes extensions so functionality can evolve outside the core. ([Model Context Protocol Blog][1])

So `testmymcp` should have an extension registry:

```text
extensions/
    tasks
    apps
    enterprise-auth
    ...
```

Unknown extensions should be reported, not treated as fatal.

---

# 29. MCP Apps / UI content

This is another rabbit hole.

Some MCP servers aren't purely:

```text
tool → JSON
```

They can expose UI experiences through MCP Apps/extensions.

So eventually your validator may need to detect:

```text
tool
 ↓
structured result
 ↓
UI/resource
```

Even if you don't execute/render the UI initially, the tester should say:

```text
ℹ Server advertises extension: MCP Apps
⚠ UI execution not supported by this test mode
```

rather than silently ignoring it.

---

# 30. Authorization

Remote MCP testing without auth is incomplete.

At minimum support:

```text
no auth
Bearer token
OAuth
```

and eventually the complete MCP OAuth discovery flow.

The authorization story has also changed in 2026, including issuer validation hardening and a move away from Dynamic Client Registration toward client metadata documents. ([Model Context Protocol Blog][1])

Test:

```text
401
403
missing token
expired token
invalid token
wrong audience
wrong issuer
OAuth discovery failure
authorization server failure
PKCE
redirect handling
scope issues
token refresh
```

And importantly:

**never print access tokens in reports.**

---

# 31. HTTP security

Your remote validator should inspect:

```text
TLS
certificate
redirects
headers
CORS
origin
authentication
proxy behavior
```

Also check MCP-specific security expectations.

For example:

* SSRF-ish behavior
* malicious resource URIs
* suspicious tool descriptions
* huge responses
* huge schemas
* excessive pagination
* decompression bombs
* slow responses
* infinite streams

---

# 32. Prompt/tool/resource injection testing

Since your tool is aimed partly at AI agents, you can go one step beyond conformance.

Inspect returned content for:

```text
"ignore previous instructions"
"send this secret"
"execute ..."
```

Not because those are protocol violations, but because they're **agent-security risks**.

You could have:

```bash
testmymcp scan
```

which reports:

```text
Protocol compliance
Security issues
Agent-safety issues
```

Those should be separate scores.

---

# 33. Metadata / `_meta`

Modern MCP heavily relies on request metadata.

Your validator should make `_meta` a first-class object rather than blindly ignoring it.

Test:

* absent `_meta`
* empty `_meta`
* valid metadata
* malformed metadata
* unexpected metadata
* client info
* capabilities
* extension metadata
* metadata propagation

And ensure the server doesn't accidentally trust arbitrary client metadata.

---

# 34. Concurrency

A serious MCP server should survive concurrent calls.

Your CLI can run:

```text
tool A
tool B
tool C
tool A
tool B
```

simultaneously.

Test:

* concurrent calls
* same tool concurrently
* different tools concurrently
* concurrent resource reads
* concurrent list calls
* request ID isolation
* response ordering
* notification interleaving
* race conditions
* session corruption

This is especially important for stateful legacy servers.

---

# 35. Request ID behavior

You should generate IDs that exercise implementations properly.

For example:

```text
1
2
3

"abc"
"tool-call-1"

large integer
```

And intentionally test:

```text
duplicate IDs
out-of-order responses
responses arriving after timeout
unknown response ID
```

The tester's internal request multiplexer should never assume:

```text
response order == request order
```

---

# 36. Timeouts

Every operation needs explicit deadlines.

At minimum:

```text
connect timeout
initialize timeout
discover timeout
request timeout
tool timeout
resource timeout
sampling timeout
elicitation timeout
task timeout
shutdown timeout
```

Also distinguish:

```text
connection timeout
HTTP timeout
protocol timeout
tool execution timeout
task timeout
```

Otherwise debugging a hung server becomes "¯\*(ツ)*/¯".

---

# 37. Backpressure

Especially important for streaming.

Test:

```text
server sends huge stream
client reads slowly
```

and:

```text
server produces events faster than client consumes
```

Measure:

* memory growth
* buffering
* dropped events
* connection behavior

This is a place where `testmymcp` can catch bugs that ordinary MCP clients won't.

---

# 38. Huge payloads

Test limits.

Examples:

```text
10 KB
1 MB
10 MB
100 MB
```

for:

* tool arguments
* tool results
* resources
* logs
* schemas
* progress messages

You don't necessarily want to actually consume unlimited payloads.

Provide:

```bash
--max-response-size
--max-resource-size
--max-schema-size
```

---

# 39. Unicode / binary correctness

Test:

```text
emoji 😭
Hindi ಕನ್ನಡ
Japanese 日本語
RTL
combining Unicode
null bytes
very long Unicode strings
```

and binary content where applicable.

Things tend to break in weird ways here, especially stdio and base64/blob handling.

---

# 40. Transport disconnect / recovery

Intentionally terminate things:

```text
server crash
socket close
TCP reset
HTTP 500
HTTP 502
HTTP 503
process kill
SSE disconnect
```

Then test what the client does.

Legacy session:

```text
disconnect
 ↓
reconnect
 ↓
new session
```

Modern:

```text
request
 ↓
disconnect
 ↓
retry request
```

with the semantics appropriate to the version.

---

# 41. Graceful shutdown

For stdio, actually inspect:

```text
SIGTERM
SIGKILL
exit code
child cleanup
```

You want to detect:

```text
server didn't terminate
server leaked process
server left grandchildren
server wrote garbage during shutdown
```

The legacy lifecycle recommends closing the input stream and escalating to termination signals when necessary. ([Model Context Protocol][3])

---

# 42. Observability / tracing

This could make `testmymcp` genuinely excellent.

Every operation should get a trace:

```text
request #42
 ├─ transport write       1.2 ms
 ├─ server response       82 ms
 ├─ progress #1           20 ms
 ├─ progress #2           40 ms
 ├─ log                   42 ms
 └─ final result          82 ms
```

Store:

```text
timestamp
direction
transport
method
request ID
headers
JSON payload
latency
status
errors
stderr
```

with redaction.

Then:

```bash
testmymcp inspect trace.json
```

could become a thing.

---

# 43. Sensitive-data redaction

This is **non-negotiable** if the tool is used against real infrastructure.

Automatically redact:

```text
Authorization
Bearer tokens
cookies
API keys
client secrets
OAuth codes
environment secrets
tool arguments marked sensitive
```

And offer:

```bash
--show-secrets
```

only with an explicit opt-in, if you even want that.

I'd default to:

```text
REDACTED
```

everywhere.

---

# 44. Deterministic CI mode

Since your target includes AI agents, I'd make machine-readable output a primary feature.

For example:

```bash
testmymcp stdio "npx my-server"
```

and:

```bash
testmymcp http https://example.com/mcp
```

Then:

```bash
testmymcp ... --json
```

returns something like:

```json
{
  "protocol": {
    "version": "2026-07-28",
    "era": "modern"
  },
  "transport": {
    "type": "streamable-http",
    "status": "pass"
  },
  "tests": {
    "tools": {
      "status": "pass",
      "count": 7
    }
  },
  "errors": [],
  "warnings": []
}
```

This is important because an AI coding agent can directly consume it.

---

# 45. Human-readable report

Then have:

```bash
testmymcp ...
```

produce something pleasant:

```text
testmymcp
────────────────────────────────────

Server
  Name       GitHub MCP
  Version    1.4.2
  Protocol   2026-07-28
  Transport  Streamable HTTP

✓ Connectivity
✓ Protocol
✓ Tool discovery        23 tools
✓ Tool schemas
✓ Pagination
✓ Resources             14
✓ Prompts                6
✓ Completions
⚠ Tasks
✗ Authorization refresh

Tools
  ✓ github_search
  ✓ github_issue
  ⚠ github_delete_issue [destructive]
```

---

# 46. Test levels

I would **strongly** recommend tiers.

### Level 0 — connectivity

```text
Can I reach it?
```

### Level 1 — protocol

```text
Is it valid MCP?
```

### Level 2 — discovery

```text
What does it expose?
```

### Level 3 — capability testing

```text
Do tools/resources/prompts actually work?
```

### Level 4 — behavioral testing

```text
Do pagination, progress, cancellation, etc. work?
```

### Level 5 — robustness

```text
What happens under concurrency, disconnects, malformed requests?
```

### Level 6 — security

```text
Is it dangerous/broken?
```

### Level 7 — fuzzing

```text
Let's make this server regret having a TCP socket.
```

That last tier should obviously be opt-in. 😂

---

# 47. The actual architecture I'd use

I'd split the project roughly like this:

```text
testmymcp
│
├── cli/
│
├── core/
│   ├── jsonrpc/
│   ├── protocol/
│   ├── requests/
│   ├── responses/
│   ├── capabilities/
│   ├── schemas/
│   └── traces/
│
├── protocols/
│   ├── legacy/
│   │   ├── initialize
│   │   ├── initialized
│   │   ├── sessions
│   │   └── legacy-features
│   │
│   └── modern/
│       ├── discover
│       ├── metadata
│       ├── mrtr
│       └── extensions
│
├── transports/
│   ├── stdio/
│   ├── streamable-http/
│   └── legacy-sse/
│
├── primitives/
│   ├── tools/
│   ├── resources/
│   ├── prompts/
│   ├── completion/
│   └── ...
│
├── client-features/
│   ├── sampling/
│   ├── elicitation/
│   ├── roots/
│   └── logging/
│
├── extensions/
│   ├── tasks/
│   ├── apps/
│   └── ...
│
├── tests/
│   ├── conformance/
│   ├── behavioral/
│   ├── robustness/
│   ├── security/
│   └── fuzz/
│
└── reporting/
    ├── terminal/
    ├── json/
    └── junit/
```

The critical design principle is:

> **Transport, protocol era, MCP primitive, and test suite should be independent dimensions.**

Don't end up with:

```text
if (stdio && oldVersion && tools) ...
```

That road leads directly to `if`-statement hell.

---

# 48. A useful internal model

I'd have every test produce something like:

```ts
interface TestResult {
  id: string;
  category: TestCategory;
  status: "pass" | "fail" | "warn" | "skip";
  severity: "info" | "low" | "medium" | "high" | "critical";

  protocol?: string;
  transport?: string;

  durationMs: number;

  request?: TraceMessage;
  response?: TraceMessage;

  error?: {
    type: string;
    code?: number;
    message: string;
  };

  evidence?: unknown;
}
```

Then your CLI/UI doesn't need to understand MCP deeply.

The **test engine produces facts**.

The renderer decides how to display them.

---

# 49. One surprisingly important distinction

I'd make your reporting distinguish these four failure layers:

```text
1. Transport failure
2. JSON-RPC failure
3. MCP protocol failure
4. Application/tool failure
```

Example:

```text
HTTP 200
 ↓
valid JSON-RPC
 ↓
valid MCP tools/call
 ↓
tool returned isError=true
```

That's **not** an MCP protocol failure.

Likewise:

```text
HTTP 500
```

is not the same thing as:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602
  }
}
```

This distinction will make your reports dramatically more useful.

---

# 50. The testing matrix ultimately becomes

This is probably the mental model I'd use for the entire project:

```text
                        MCP TEST MATRIX

                  ┌── Protocol version
                  │
                  ├── Lifecycle
                  │
                  ├── Transport
                  │    ├── stdio
                  │    ├── Streamable HTTP
                  │    └── legacy SSE
                  │
                  ├── JSON-RPC
                  │
                  ├── Server primitives
                  │    ├── Tools
                  │    ├── Resources
                  │    ├── Prompts
                  │    └── Completion
                  │
                  ├── Client capabilities
                  │    ├── Roots
                  │    ├── Sampling
                  │    └── Elicitation
                  │
                  ├── Runtime behavior
                  │    ├── Progress
                  │    ├── Cancellation
                  │    ├── Logging
                  │    ├── Pagination
                  │    ├── Concurrency
                  │    └── Streaming
                  │
                  ├── Modern protocol
                  │    ├── server/discover
                  │    ├── MRTR
                  │    ├── metadata
                  │    └── routing headers
                  │
                  ├── Extensions
                  │    ├── Tasks
                  │    ├── MCP Apps
                  │    └── future extensions
                  │
                  ├── Authentication
                  │
                  ├── Security
                  │
                  ├── Reliability
                  │
                  └── Fuzz / adversarial testing
```

And **this is actually where I think `testmymcp` could become much more interesting than a normal MCP client**.

The killer feature isn't:

> "Connect to MCP server and call a tool."

It's:

> **"Given this MCP endpoint, tell me whether it actually behaves like a correct, usable, robust MCP server — and show me the exact evidence when it doesn't."**

The 2026 protocol revision makes this especially valuable because the ecosystem is now straddling a genuinely significant legacy/modern behavioral split. ([Model Context Protocol Blog][1])

### What I'd build first

I wouldn't implement all 50 things immediately. I'd make the core vertical slice:

```text
CLI
 ↓
transport abstraction
 ↓
protocol detection
 ↓
JSON-RPC engine
 ↓
discover/initialize
 ↓
capability discovery
 ↓
tools/list
 ↓
safe tools/call
 ↓
progress + streaming
 ↓
structured report
 ↓
JSON output
```

Then add resources/prompts/auth/tasks/etc. as **independent test modules**.

That gives you a useful tool very early without accidentally building the MCP equivalent of a compiler before you've run `hello world`. 😭

[1]: https://blog.modelcontextprotocol.io/posts/2026-07-28/?utm_source=chatgpt.com "The 2026-07-28 Specification | Model Context Protocol Blog"
[2]: https://py.sdk.modelcontextprotocol.io/api/mcp_types/version/?utm_source=chatgpt.com "version - MCP Python SDK"
[3]: https://modelcontextprotocol.io/specification/2024-11-05/basic/lifecycle?utm_source=chatgpt.com "Lifecycle - Model Context Protocol"
[4]: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports?utm_source=chatgpt.com "Transports - Model Context Protocol"
[5]: https://ts.sdk.modelcontextprotocol.io/server?utm_source=chatgpt.com "Server | MCP TypeScript SDK (v1)"
[6]: https://modelcontextprotocol.io/specification/2024-11-05/basic/messages?utm_source=chatgpt.com "Messages - Model Context Protocol"
[7]: https://modelcontextprotocol.io/specification/2024-11-05/server/utilities/pagination?utm_source=chatgpt.com "Pagination - Model Context Protocol"
[8]: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/?utm_source=chatgpt.com "The 2026-07-28 MCP Specification Release Candidate | Model Context Protocol Blog"
[9]: https://modelcontextprotocol.io/specification/2024-11-05/server/tools?utm_source=chatgpt.com "Tools - Model Context Protocol"
[10]: https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions?utm_source=chatgpt.com "Protocol versions | MCP TypeScript SDK"
[11]: https://modelcontextprotocol.io/specification/2024-11-05/server/utilities/completion?utm_source=chatgpt.com "Completion - Model Context Protocol"
[12]: https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks?utm_source=chatgpt.com "Tasks | MCP Tasks Extension"
