import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createProgram } from "../src/cli/program.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function loadPackageVersion(): Promise<string> {
  const raw = await readFile(resolve(repoRoot, "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error("package.json is missing a string 'version' field");
  }
  return parsed.version;
}

describe("version consistency", () => {
  it("publishes the package.json version on the CLI program", async () => {
    const expected = await loadPackageVersion();
    const program = createProgram();
    expect(program.version()).toBe(expected);
  });

  it("publishes the package.json version on the MCP server source", async () => {
    const expected = await loadPackageVersion();
    const serverSource = await readFile(
      resolve(repoRoot, "src/mcp/server.ts"),
      "utf8",
    );
    const match = serverSource.match(
      /name:\s*"ralph-research"\s*,\s*version:\s*"([^"]+)"/,
    );
    expect(match, "expected ralph-research McpServer literal in src/mcp/server.ts").not.toBeNull();
    expect(match?.[1]).toBe(expected);
  });
});
