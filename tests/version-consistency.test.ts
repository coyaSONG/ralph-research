import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createProgram } from "../src/cli/program.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function loadPackageJson(): Promise<{ name: string; version: string }> {
  const raw = await readFile(resolve(repoRoot, "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
  if (typeof parsed.name !== "string" || parsed.name.length === 0) {
    throw new Error("package.json is missing a string 'name' field");
  }
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error("package.json is missing a string 'version' field");
  }
  return { name: parsed.name, version: parsed.version };
}

async function loadPackageVersion(): Promise<string> {
  return (await loadPackageJson()).version;
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

  it("keeps package-lock.json name and version in lockstep with package.json", async () => {
    const expected = await loadPackageJson();
    const lockRaw = await readFile(resolve(repoRoot, "package-lock.json"), "utf8");
    const lockParsed = JSON.parse(lockRaw) as {
      name?: unknown;
      version?: unknown;
      packages?: Record<string, { name?: unknown; version?: unknown } | undefined>;
    };

    expect(lockParsed.name, "package-lock.json must declare the same top-level name").toBe(
      expected.name,
    );
    expect(lockParsed.version, "package-lock.json must declare the same top-level version").toBe(
      expected.version,
    );

    const rootPackage = lockParsed.packages?.[""];
    expect(rootPackage, 'package-lock.json must include a "" root entry').toBeDefined();
    expect(rootPackage?.name).toBe(expected.name);
    expect(rootPackage?.version).toBe(expected.version);
  });
});
