import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { evaluateChangeBudget } from "../src/core/engine/change-budget.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-budget-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("bounded change enforcement", () => {
  it("passes when only allowed files change within budget", async () => {
    const repoRoot = await initTempGitRepo();

    await writeFile(
      join(repoRoot, "docs", "guide.md"),
      "Guide\n\nThis draft is clearer.\nIt keeps the same scope.\n",
      "utf8",
    );

    const decision = await evaluateChangeBudget({
      workspacePath: repoRoot,
      scope: {
        allowedGlobs: ["**/*.md"],
        maxFilesChanged: 2,
        maxLineDelta: 10,
      },
    });

    expect(decision.withinBudget).toBe(true);
    expect(decision.outcome).toBe("none");
    expect(decision.summary.filesChanged).toBe(1);
  });

  it("blocks modifications outside allowed globs", async () => {
    const repoRoot = await initTempGitRepo();

    await writeFile(join(repoRoot, "config.json"), '{"unsafe":true}\n', "utf8");

    const decision = await evaluateChangeBudget({
      workspacePath: repoRoot,
      scope: {
        allowedGlobs: ["**/*.md"],
        maxFilesChanged: 2,
        maxLineDelta: 10,
      },
    });

    expect(decision.withinBudget).toBe(false);
    expect(decision.outcome).toBe("rejected");
    expect(decision.violations.some((violation) => violation.kind === "disallowed_path")).toBe(true);
  });

  it("blocks changes whose line delta exceeds the budget", async () => {
    const repoRoot = await initTempGitRepo();

    await writeFile(
      join(repoRoot, "docs", "guide.md"),
      "Guide\n\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\n",
      "utf8",
    );

    const decision = await evaluateChangeBudget({
      workspacePath: repoRoot,
      scope: {
        allowedGlobs: ["**/*.md"],
        maxFilesChanged: 2,
        maxLineDelta: 3,
      },
    });

    expect(decision.withinBudget).toBe(false);
    expect(decision.outcome).toBe("rejected");
    expect(decision.violations.some((violation) => violation.kind === "max_line_delta_exceeded")).toBe(true);
  });

  it("can escalate scope violations to needs_human instead of auto-rejecting", async () => {
    const repoRoot = await initTempGitRepo();

    await mkdir(join(repoRoot, "notes"), { recursive: true });
    await writeFile(join(repoRoot, "notes", "a.md"), "a\n", "utf8");
    await writeFile(join(repoRoot, "notes", "b.md"), "b\n", "utf8");

    const decision = await evaluateChangeBudget({
      workspacePath: repoRoot,
      scope: {
        allowedGlobs: ["**/*.md"],
        maxFilesChanged: 1,
        maxLineDelta: 10,
      },
      violationOutcome: "needs_human",
    });

    expect(decision.withinBudget).toBe(false);
    expect(decision.outcome).toBe("needs_human");
    expect(decision.violations.some((violation) => violation.kind === "max_files_changed_exceeded")).toBe(true);
  });
});

async function initTempGitRepo(): Promise<string> {
  const repoRoot = join(tempRoot, "repo");
  await mkdir(join(repoRoot, "docs"), { recursive: true });

  await execa("git", ["init"], { cwd: repoRoot });
  await execa("git", ["config", "user.name", "Ralph Research Tests"], { cwd: repoRoot });
  await execa("git", ["config", "user.email", "tests@example.com"], { cwd: repoRoot });

  await writeFile(join(repoRoot, "docs", "guide.md"), "Guide\n\nBaseline text.\n", "utf8");
  await writeFile(join(repoRoot, "src.ts"), "export const value = 1;\n", "utf8");

  await execa("git", ["add", "."], { cwd: repoRoot });
  await execa("git", ["commit", "-m", "initial fixture"], { cwd: repoRoot });

  return repoRoot;
}
