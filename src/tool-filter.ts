/**
 * Opt-in tool registration filter.
 *
 * When the OPENCODE_ENABLED_TOOLS env var is set to a comma-separated list
 * of tool names, only those tools are registered on the MCP server. Any
 * other `server.tool(name, ...)` call becomes a no-op. This keeps the tool
 * surface small for clients that only need a subset of the 79 built-in
 * tools (for example, to avoid context pollution in an LLM client).
 *
 * The feature is fully opt-in: when the env var is unset or empty, the
 * server behaves exactly as before and all tools are registered.
 *
 * Usage:
 *   OPENCODE_ENABLED_TOOLS="opencode_run,opencode_check" npx opencode-mcp
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Parse the OPENCODE_ENABLED_TOOLS env var value into a Set of allowed
 * tool names. Returns `null` when the value is undefined, empty, or
 * contains only whitespace — that is the signal for "no filtering".
 *
 * Whitespace around entries is trimmed, empty entries are dropped.
 */
export function parseEnabledTools(
  value: string | undefined,
): Set<string> | null {
  if (!value) return null;
  const names = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (names.length === 0) return null;
  return new Set(names);
}

/**
 * Result of applying a tool filter to an MCP server. `skipped` is a live
 * array that is populated as registration calls are made — read it after
 * all `register*Tools(...)` invocations have completed.
 */
export interface ToolFilterResult {
  /** Names of tools that were blocked by the allowlist. */
  skipped: string[];
  /** Names of tools that were allowed through. */
  registered: string[];
}

/**
 * Monkey-patch `server.tool` so that registrations whose name is not in
 * the allowlist become no-ops. When `allowlist` is `null`, the server is
 * left untouched and this function returns empty tracking arrays.
 *
 * The patch is intentionally minimal so the feature is additive and easy
 * to remove: it does not touch any of the existing `register*Tools`
 * functions, does not change the MCP handshake, and has no effect at all
 * when the env var is unset.
 */
export function applyToolFilter(
  server: McpServer,
  allowlist: Set<string> | null,
): ToolFilterResult {
  const result: ToolFilterResult = { skipped: [], registered: [] };
  if (!allowlist) return result;

  // The McpServer.tool signature is `(name, description, schema?, handler)`
  // and is typed as a heavily-overloaded method. We only care about the
  // first argument (the tool name), so we widen the type locally and
  // preserve everything else by spreading the arguments.
  type ToolFn = (...args: unknown[]) => unknown;
  const target = server as unknown as { tool: ToolFn };
  const original = target.tool.bind(server) as ToolFn;

  target.tool = (...args: unknown[]) => {
    const name = args[0];
    if (typeof name !== "string") {
      // Defensive: if the SDK ever calls `tool(...)` without a string
      // name we forward it unchanged rather than dropping the call.
      return original(...args);
    }
    if (!allowlist.has(name)) {
      result.skipped.push(name);
      return undefined;
    }
    result.registered.push(name);
    return original(...args);
  };

  return result;
}

// ── Filtered-mode instructions builder ─────────────────────────────────

/**
 * Context used to parameterise the filtered-mode instructions text.
 * Mirrors the env-var driven defaults the server already honours, so
 * the filtered instructions can show accurate examples.
 */
export interface FilteredInstructionsContext {
  /** OPENCODE_DEFAULT_PROVIDER, if set. */
  defaultProvider?: string;
  /** OPENCODE_DEFAULT_MODEL, if set. */
  defaultModel?: string;
}

/**
 * One-line descriptions for the most commonly filter-kept tools. If a
 * tool in the allowlist is not present here, the filtered instructions
 * fall back to listing just the tool name. The per-tool MCP schemas
 * still carry the authoritative description, so this map is only used
 * to give the top-level instructions a slightly friendlier readout.
 */
const TOOL_ONE_LINERS: Readonly<Record<string, string>> = {
  opencode_setup:
    "first-time onboarding, health check, provider readiness (read-only)",
  opencode_ask:
    "one-shot question or short task; creates a session and returns the response in a single call",
  opencode_run:
    "send a task and wait for completion in one call; best for tasks under ~10 minutes",
  opencode_fire:
    "fire-and-forget: start a task and return immediately; pair with opencode_check / opencode_wait",
  opencode_check:
    "cheap progress report on a running session: status, todos, file counts (read-only)",
  opencode_wait:
    "block until a session finishes processing; emits progress notifications while waiting",
  opencode_reply:
    "continue an existing session with a follow-up prompt (cheaper than a fresh run)",
  opencode_review_changes:
    "list all file diffs produced by a session (read-only) — the review gate for delegated work",
  opencode_provider_models:
    "list available models for a specific provider (read-only)",
  opencode_provider_list:
    "list all configured providers (read-only)",
  opencode_context:
    "get project info: path, git branch, configured agents (read-only)",
  opencode_session_todo:
    "see the agent's internal task list for a running session (read-only)",
  opencode_status:
    "quick server health dashboard (read-only)",
  opencode_sessions_overview:
    "list all sessions with status (read-only)",
  opencode_conversation:
    "get the full message history of a session (read-only)",
};

/**
 * Build an instructions text that accurately describes the filtered tool
 * surface. Returns a short, self-contained document: title, short
 * explanation of filtered mode, bullet list of registered tools, and
 * the usage notes that apply regardless of which tools are enabled.
 *
 * This intentionally does NOT attempt to rewrite the 5-tier guide from
 * the default instructions — most of it references tools that are no
 * longer available, and a stripped-down list is both shorter and more
 * accurate than a partially-edited copy.
 */
export function buildFilteredInstructions(
  allowlist: Set<string>,
  context: FilteredInstructionsContext = {},
): string {
  const names = Array.from(allowlist).sort();
  const exProvider = context.defaultProvider || "<your-provider>";
  const exModel = context.defaultModel || "<your-model>";

  const toolLines = names.map((name) => {
    const desc = TOOL_ONE_LINERS[name];
    return desc ? `- \`${name}\` — ${desc}` : `- \`${name}\``;
  });

  // Build a realistic example command for whichever tool is most
  // natural for the current allowlist. Preference order: run, ask,
  // fire. If none of these are enabled, we skip the example block.
  const exampleTool = names.includes("opencode_run")
    ? "opencode_run"
    : names.includes("opencode_ask")
      ? "opencode_ask"
      : names.includes("opencode_fire")
        ? "opencode_fire"
        : undefined;

  const lines: string[] = [
    "# OpenCode MCP — Filtered Mode",
    "",
    `This server is running with \`OPENCODE_ENABLED_TOOLS\` set, so only ${names.length} of the 79 built-in tools are registered. The per-tool MCP schemas are authoritative — the list below is a short readout for orientation.`,
    "",
    "## Registered tools",
    ...toolLines,
    "",
    "## Usage notes",
    "- ALWAYS pass `providerID` and `modelID` explicitly when invoking a tool that runs a task. Do NOT hardcode any specific provider; discover them via `opencode_setup` (and `opencode_provider_models` if it is in the allowlist). If the `OPENCODE_DEFAULT_PROVIDER` and `OPENCODE_DEFAULT_MODEL` env vars are set, they are used as fallbacks when the arguments are omitted.",
    "- The `directory` parameter on every tool targets a specific project. It must be an absolute path to an existing directory. Both POSIX (`/home/user/project`) and Windows (`C:\\\\Users\\\\me\\\\project`) forms are accepted.",
    "- Tools whose annotations include `readOnlyHint: true` are safe and do not modify state.",
    "- Tools whose annotations include `destructiveHint: true` permanently delete data — confirm with the user before calling.",
  ];

  if (exampleTool) {
    lines.push(
      "",
      "## Example",
      "```",
      `${exampleTool}({prompt: "Summarise the repo", providerID: "${exProvider}", modelID: "${exModel}"})`,
      "```",
    );
  }

  return lines.join("\n");
}
