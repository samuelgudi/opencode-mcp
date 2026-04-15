import { describe, it, expect } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyToolFilter, parseEnabledTools } from "../src/tool-filter.js";

// A minimal stand-in for McpServer that only implements what the filter
// touches. The real SDK type has an overloaded `tool(...)` method — we
// match that shape loosely with `(...args: unknown[]) => unknown`.
function makeFakeServer(): {
  server: McpServer;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  const fake = {
    tool: (...args: unknown[]): unknown => {
      calls.push(args);
      return undefined;
    },
  };
  return { server: fake as unknown as McpServer, calls };
}

describe("parseEnabledTools", () => {
  it("returns null for undefined", () => {
    expect(parseEnabledTools(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseEnabledTools("")).toBeNull();
  });

  it("returns null for whitespace only", () => {
    expect(parseEnabledTools("   ,  , ")).toBeNull();
  });

  it("parses a single tool name", () => {
    const set = parseEnabledTools("opencode_run");
    expect(set).not.toBeNull();
    expect(set?.has("opencode_run")).toBe(true);
    expect(set?.size).toBe(1);
  });

  it("parses a comma-separated list", () => {
    const set = parseEnabledTools("opencode_run,opencode_check,opencode_fire");
    expect(set?.size).toBe(3);
    expect(set?.has("opencode_run")).toBe(true);
    expect(set?.has("opencode_check")).toBe(true);
    expect(set?.has("opencode_fire")).toBe(true);
  });

  it("trims whitespace around entries", () => {
    const set = parseEnabledTools("  opencode_run ,\topencode_check  ");
    expect(set?.has("opencode_run")).toBe(true);
    expect(set?.has("opencode_check")).toBe(true);
    expect(set?.size).toBe(2);
  });

  it("filters empty entries", () => {
    const set = parseEnabledTools("opencode_run,,opencode_check,");
    expect(set?.size).toBe(2);
  });

  it("deduplicates repeated entries", () => {
    const set = parseEnabledTools("opencode_run,opencode_run,opencode_run");
    expect(set?.size).toBe(1);
  });
});

describe("applyToolFilter", () => {
  it("is a no-op when allowlist is null", () => {
    const { server, calls } = makeFakeServer();
    const result = applyToolFilter(server, null);
    expect(result.skipped).toEqual([]);
    expect(result.registered).toEqual([]);

    // All tool() calls still reach the underlying server.
    (server as unknown as { tool: (...a: unknown[]) => unknown }).tool(
      "opencode_run",
      "desc",
    );
    (server as unknown as { tool: (...a: unknown[]) => unknown }).tool(
      "opencode_check",
      "desc",
    );
    expect(calls).toHaveLength(2);
  });

  it("registers tools whose names are in the allowlist", () => {
    const { server, calls } = makeFakeServer();
    const result = applyToolFilter(
      server,
      new Set(["opencode_run", "opencode_check"]),
    );

    const tool = (server as unknown as { tool: (...a: unknown[]) => unknown })
      .tool;
    tool("opencode_run", "desc", {}, () => ({}));
    tool("opencode_check", "desc", {}, () => ({}));

    expect(calls).toHaveLength(2);
    expect(result.registered).toEqual(["opencode_run", "opencode_check"]);
    expect(result.skipped).toEqual([]);
  });

  it("skips tools not in the allowlist and tracks them", () => {
    const { server, calls } = makeFakeServer();
    const result = applyToolFilter(server, new Set(["opencode_run"]));

    const tool = (server as unknown as { tool: (...a: unknown[]) => unknown })
      .tool;
    tool("opencode_run", "desc", {}, () => ({}));
    tool("opencode_tui_open_help", "desc", {}, () => ({}));
    tool("opencode_session_delete", "desc", {}, () => ({}));
    tool("opencode_run", "desc", {}, () => ({}));

    // Underlying server should only see the two `opencode_run` calls.
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[0]).toBe("opencode_run");
    expect(calls[1]?.[0]).toBe("opencode_run");

    expect(result.registered).toEqual(["opencode_run", "opencode_run"]);
    expect(result.skipped).toEqual([
      "opencode_tui_open_help",
      "opencode_session_delete",
    ]);
  });

  it("forwards calls unchanged when the first argument is not a string", () => {
    // Defensive guard: unexpected shape should not cause a data loss.
    const { server, calls } = makeFakeServer();
    applyToolFilter(server, new Set(["opencode_run"]));

    const tool = (server as unknown as { tool: (...a: unknown[]) => unknown })
      .tool;
    // Simulate a hypothetical SDK call that does not pass a string name.
    tool(undefined as unknown as string, "desc");
    expect(calls).toHaveLength(1);
  });

  it("preserves argument order and count when forwarding", () => {
    const { server, calls } = makeFakeServer();
    applyToolFilter(server, new Set(["opencode_run"]));

    const handler = () => ({});
    const schema = { foo: "bar" };
    const tool = (server as unknown as { tool: (...a: unknown[]) => unknown })
      .tool;
    tool("opencode_run", "a description", schema, handler);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      "opencode_run",
      "a description",
      schema,
      handler,
    ]);
  });
});
