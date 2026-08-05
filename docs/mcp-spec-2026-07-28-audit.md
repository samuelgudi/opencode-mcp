# MCP Spec 2026-07-28 — Audit (2026-08-05)

Audit of this repo against the new MCP specification, done 2026-08-05 during a cross-project MCP review on Morpheus.

## Background: the MCP 2026-07-28 specification

On 2026-07-28 the Model Context Protocol released a major spec revision
(https://blog.modelcontextprotocol.io/posts/2026-07-28/). Key changes:

- **Stateless core**: MCP moves from a stateful session protocol (initialize
  handshake + `Mcp-Session-Id` header) to pure request/response. Every request
  carries protocol version, client identity and capabilities in `_meta`. Any
  request can land on any server instance (load balancers, serverless, edge).
  Applications needing state should mint an explicit handle from a tool and
  have the model pass it back as an argument.
- **MRTR (Multi Round-Trip Requests)**: replaces server-initiated requests over
  held-open streams. A tool needing mid-call input returns
  `resultType: "input_required"`; the client retries with `inputResponses`.
- **Header routing**: Streamable HTTP requests must carry `Mcp-Method` and
  `Mcp-Name` HTTP headers so gateways/WAFs can route without parsing JSON.
- **Caching**: `tools/list`, `prompts/list`, `resources/list`, `resources/read`
  responses gain `ttlMs` and `cacheScope`.
- **Auth hardening**: mandatory RFC 9207 `iss` validation, credentials bound to
  the issuing authorization server, `application_type` at registration
  (fixes localhost redirects for CLI/desktop apps), DCR deprecated in favor of
  Client ID Metadata Documents (CIMD).
- **Extensions framework**: Tasks (`io.modelcontextprotocol/tasks`, poll-based
  `tasks/get` + single opt-in `subscriptions/listen` stream), MCP Apps,
  Enterprise Managed Authorization.
- **Deprecated (12-month minimum window)**: Roots, Sampling, Logging
  capability, and the legacy HTTP+SSE transport.

stdio transport is unchanged. SDKs supporting the new spec: TypeScript,
Python, Go, C# (Tier 1); Rust in beta.

## Findings for opencode-mcp

- `opencode_wait` emits progress via `notifications/message` (`src/index.ts`)
  — this is the MCP **Logging capability, now formally deprecated**
  (12-month minimum window). Only deprecated-feature usage found in this repo.
- The SSE code in `src/client.ts` is opencode's own HTTP API (event
  subscription), **not** the MCP transport — unaffected by the HTTP+SSE
  transport deprecation.
- `@modelcontextprotocol/sdk` pinned at `^1.12.1` (predates the new spec).
- The fire/check/wait tool trio is conceptually identical to the new **Tasks
  extension** (`io.modelcontextprotocol/tasks`): `opencode_fire` ≈ task
  creation, `opencode_check` ≈ `tasks/get` polling, `opencode_wait` ≈
  blocking on task completion.

## Recommended actions

1. Migrate progress signaling off `notifications/message` — natural target
   is the Tasks extension (`tasks/get` polling + optional
   `subscriptions/listen`). Small refactor, high conformance value.
2. Upgrade `@modelcontextprotocol/sdk` to a 2026-07-28-capable version.
3. No transport work needed (stdio server).
