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

  it("publishes the standard npm metadata fields needed for an honest npmjs.com listing", async () => {
    const raw = await readFile(resolve(repoRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      repository?: { type?: unknown; url?: unknown };
      bugs?: { url?: unknown };
      homepage?: unknown;
      author?: unknown;
      engines?: { node?: unknown };
      keywords?: unknown;
    };

    expect(parsed.repository?.type, "package.json must declare repository.type").toBe("git");
    expect(typeof parsed.repository?.url, "package.json must declare repository.url").toBe("string");
    expect(parsed.repository?.url).toMatch(/coyaSONG\/ralph-research(\.git)?$/);

    expect(typeof parsed.bugs?.url, "package.json must declare bugs.url").toBe("string");
    expect(parsed.bugs?.url).toMatch(/issues$/);

    expect(typeof parsed.homepage, "package.json must declare a homepage URL").toBe("string");

    expect(typeof parsed.author, "package.json must declare author").toBe("string");

    expect(typeof parsed.engines?.node, "package.json must declare engines.node").toBe("string");
    expect(parsed.engines?.node).toMatch(/>=\s*24/);

    expect(Array.isArray(parsed.keywords), "package.json must declare keywords array").toBe(true);
    expect((parsed.keywords as string[]).length).toBeGreaterThanOrEqual(4);
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
