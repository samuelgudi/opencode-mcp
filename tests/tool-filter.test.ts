import { describe, it, expect } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  applyToolFilter,
  buildFilteredInstructions,
  parseEnabledTools,
} from "../src/tool-filter.js";

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

describe("buildFilteredInstructions", () => {
  it("renders the filtered-mode header and tool count", () => {
    const text = buildFilteredInstructions(
      new Set(["opencode_run", "opencode_check"]),
    );
    expect(text).toContain("# OpenCode MCP — Filtered Mode");
    expect(text).toContain("only 2 of the 79 built-in tools");
  });

  it("lists every registered tool as a bullet", () => {
    const text = buildFilteredInstructions(
      new Set(["opencode_run", "opencode_check", "opencode_reply"]),
    );
    expect(text).toContain("- `opencode_run`");
    expect(text).toContain("- `opencode_check`");
    expect(text).toContain("- `opencode_reply`");
  });

  it("sorts the tool list deterministically", () => {
    const text = buildFilteredInstructions(
      new Set(["opencode_run", "opencode_check", "opencode_fire"]),
    );
    const checkIdx = text.indexOf("`opencode_check`");
    const fireIdx = text.indexOf("`opencode_fire`");
    const runIdx = text.indexOf("`opencode_run`");
    expect(checkIdx).toBeGreaterThan(-1);
    expect(fireIdx).toBeGreaterThan(checkIdx);
    expect(runIdx).toBeGreaterThan(fireIdx);
  });

  it("attaches one-line descriptions for known tools", () => {
    const text = buildFilteredInstructions(new Set(["opencode_run"]));
    expect(text).toContain("send a task and wait for completion");
  });

  it("falls back to just the name for unknown tools", () => {
    const text = buildFilteredInstructions(
      new Set(["opencode_some_future_tool"]),
    );
    // Name is present as a bullet, but no em-dash / description follows.
    expect(text).toMatch(/- `opencode_some_future_tool`\s*\n/);
  });

  it("never mentions tools that are filtered out", () => {
    const text = buildFilteredInstructions(
      new Set(["opencode_run", "opencode_check"]),
    );
    // Sanity: tools we know exist upstream but are NOT in the allowlist
    // must not appear anywhere in the rendered text.
    expect(text).not.toContain("opencode_tui_");
    expect(text).not.toContain("opencode_session_delete");
    expect(text).not.toContain("opencode_shell_execute");
    expect(text).not.toContain("opencode_instance_dispose");
  });

  it("always includes the directory parameter note with Windows example", () => {
    const text = buildFilteredInstructions(new Set(["opencode_run"]));
    expect(text).toContain("directory");
    expect(text).toContain("absolute path");
    // The note shows both POSIX and Windows examples — the Windows form
    // is escaped through two layers (JS string -> rendered markdown).
    expect(text).toContain("/home/user/project");
    expect(text).toContain("C:\\\\Users\\\\me\\\\project");
  });

  it("emits an example block when opencode_run is enabled", () => {
    const text = buildFilteredInstructions(
      new Set(["opencode_run", "opencode_check"]),
      { defaultProvider: "opencode", defaultModel: "minimax-m2.5-free" },
    );
    expect(text).toContain("## Example");
    expect(text).toContain("opencode_run(");
    expect(text).toContain('providerID: "opencode"');
    expect(text).toContain('modelID: "minimax-m2.5-free"');
  });

  it("prefers opencode_run over opencode_ask for the example", () => {
    const text = buildFilteredInstructions(
      new Set(["opencode_run", "opencode_ask"]),
    );
    // Example should reference run, not ask.
    const exampleSection = text.split("## Example")[1] ?? "";
    expect(exampleSection).toContain("opencode_run(");
    expect(exampleSection).not.toContain("opencode_ask(");
  });

  it("falls back to opencode_ask when run is not enabled", () => {
    const text = buildFilteredInstructions(new Set(["opencode_ask"]));
    const exampleSection = text.split("## Example")[1] ?? "";
    expect(exampleSection).toContain("opencode_ask(");
  });

  it("falls back to opencode_fire when neither run nor ask is enabled", () => {
    const text = buildFilteredInstructions(
      new Set(["opencode_fire", "opencode_check"]),
    );
    const exampleSection = text.split("## Example")[1] ?? "";
    expect(exampleSection).toContain("opencode_fire(");
  });

  it("omits the example block when no task-running tool is enabled", () => {
    const text = buildFilteredInstructions(
      new Set(["opencode_setup", "opencode_check"]),
    );
    expect(text).not.toContain("## Example");
  });

  it("uses placeholder provider/model when env-var defaults are absent", () => {
    const text = buildFilteredInstructions(new Set(["opencode_run"]));
    expect(text).toContain('providerID: "<your-provider>"');
    expect(text).toContain('modelID: "<your-model>"');
  });
});
