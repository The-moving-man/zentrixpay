/**
 * Tests that keep docs/mcp-client-configs.md honest.
 *
 * The client config page is what operators paste into Claude Code, Claude
 * Desktop, Codex, Cursor, VS Code, and Windsurf. Documentation that drifts
 * from the code is worse than none — a stale variable name or an unbalanced
 * JSON snippet costs an operator a debugging session. These tests check the
 * page against the source of truth: every environment variable the server
 * reads is documented (and vice versa), every JSON snippet parses, and the
 * documented state path is the one the server actually writes.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(SRC_DIR, "..", "..", "docs");
const CONFIG_DOC = join(DOCS_DIR, "mcp-client-configs.md");

const doc = readFileSync(CONFIG_DOC, "utf-8");

/**
 * Variables the server reads that are deliberately undocumented: VITEST is set
 * by the test runner, not by operators.
 */
const INTERNAL_VARS = new Set(["VITEST"]);

/** Every environment variable read anywhere in mcp/src (excluding tests). */
function environmentVariablesUsedInSource(): Set<string> {
  const found = new Set<string>();
  for (const file of readdirSync(SRC_DIR)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = readFileSync(join(SRC_DIR, file), "utf-8");
    // Matches process.env.FOO and the `env.FOO` form used by pure helpers that
    // take a ProcessEnv argument.
    for (const match of source.matchAll(/\benv\.([A-Z][A-Z0-9_]+)\b/g)) {
      if (!INTERNAL_VARS.has(match[1])) found.add(match[1]);
    }
  }
  return found;
}

/** Variable names listed in the doc's environment table (`| \`NAME\` | …`). */
function documentedEnvironmentVariables(): Set<string> {
  const table = doc.slice(doc.indexOf("## Environment variables"), doc.indexOf("## State path"));
  const names = new Set<string>();
  for (const match of table.matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/gm)) names.add(match[1]);
  return names;
}

/** Every fenced ```json block in the page. */
function jsonSnippets(): string[] {
  return [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
}

describe("docs/mcp-client-configs.md", () => {
  it("documents every environment variable the server reads", () => {
    const documented = documentedEnvironmentVariables();
    for (const variable of environmentVariablesUsedInSource()) {
      expect(documented, `${variable} is read by the server but not documented`).toContain(
        variable,
      );
    }
  });

  it("does not document variables the server never reads", () => {
    const used = environmentVariablesUsedInSource();
    for (const variable of documentedEnvironmentVariables()) {
      expect(used, `${variable} is documented but never read`).toContain(variable);
    }
  });

  it("every JSON config snippet parses", () => {
    const snippets = jsonSnippets();
    expect(snippets.length).toBeGreaterThan(0);
    for (const snippet of snippets) {
      expect(() => JSON.parse(snippet), `invalid JSON snippet:\n${snippet}`).not.toThrow();
    }
  });

  it("every stdio config points at the built entrypoint", () => {
    for (const snippet of jsonSnippets()) {
      const config = JSON.parse(snippet) as Record<string, Record<string, { args?: string[] }>>;
      const servers = config.mcpServers ?? config.servers;
      for (const server of Object.values(servers)) {
        expect(server.args?.[0]).toMatch(/mcp\/dist\/index\.js$/);
      }
    }
  });

  it("documents the state path the server actually writes", () => {
    const index = readFileSync(join(SRC_DIR, "index.ts"), "utf-8");
    expect(index).toContain('join(homedir(), ".zentrixpay")');
    expect(index).toContain('join(STATE_DIR, "state.json")');
    expect(doc).toContain("~/.zentrixpay/state.json");
    expect(doc).toContain("0600");
  });

  it("covers each supported client and the required sections", () => {
    for (const heading of [
      "## Claude Code",
      "## Claude Desktop",
      "## Codex",
      "## Cursor",
      "## VS Code",
      "## Windsurf",
      "## Environment variables",
      "## State path",
      "## Network profile",
      "## Security notes",
    ]) {
      expect(doc, `missing section: ${heading}`).toContain(heading);
    }
  });
});
