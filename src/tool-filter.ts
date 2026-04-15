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
