import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function extractMarkdownLinks(source: string): string[] {
  const matches = source.matchAll(/\[[^\]]+\]\(([^)\s#]+)(?:#[^)]*)?\)/g);
  const targets: string[] = [];
  for (const match of matches) {
    const raw = match[1];
    if (!raw) continue;
    if (
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("mailto:") ||
      raw.startsWith("#")
    ) {
      continue;
    }
    targets.push(raw);
  }
  return targets;
}

describe("README link integrity", () => {
  it("every relative link in README.md resolves to a file in the repo", async () => {
    const readmePath = resolve(repoRoot, "README.md");
    const source = await readFile(readmePath, "utf8");
    const targets = extractMarkdownLinks(source);
    expect(targets.length, "README must contain at least one relative link").toBeGreaterThan(0);

    const missing: string[] = [];
    for (const target of targets) {
      const absolute = resolve(repoRoot, target);
      if (!(await exists(absolute))) {
        missing.push(target);
      }
    }

    expect(missing, `README has dangling relative links: ${missing.join(", ")}`).toEqual([]);
  });

  it("every relative link in CHANGELOG.md resolves (excluding GitHub compare URLs)", async () => {
    const changelogPath = resolve(repoRoot, "CHANGELOG.md");
    const source = await readFile(changelogPath, "utf8");
    const targets = extractMarkdownLinks(source);

    const missing: string[] = [];
    for (const target of targets) {
      const absolute = resolve(repoRoot, target);
      if (!(await exists(absolute))) {
        missing.push(target);
      }
    }

    expect(missing, `CHANGELOG has dangling relative links: ${missing.join(", ")}`).toEqual([]);
  });
});
