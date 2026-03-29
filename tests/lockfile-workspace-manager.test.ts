import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireLock, isStaleLock, readLockMetadata, releaseLock } from "../src/adapters/fs/lockfile.js";
import { GitWorktreeWorkspaceManager } from "../src/core/engine/workspace-manager.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-workspace-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("lockfile", () => {
  it("acquires and releases a fresh lock", async () => {
    const lockPath = join(tempRoot, ".ralph", "lock");

    const handle = await acquireLock(lockPath);

    expect(await isStaleLock(lockPath)).toBe(false);
    expect((await readLockMetadata(lockPath))?.token).toBe(handle.metadata.token);

    await releaseLock(lockPath, handle.metadata.token);

    expect(await readLockMetadata(lockPath)).toBeNull();
  });

  it("recovers a stale lock and replaces its metadata", async () => {
    const lockPath = join(tempRoot, ".ralph", "lock");
    await mkdir(dirname(lockPath), { recursive: true });

    await writeFile(
      lockPath,
      `${JSON.stringify(
        {
          pid: 999_999,
          token: "stale-token",
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
          ttlMs: 10_000,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    expect(await isStaleLock(lockPath)).toBe(true);

    const handle = await acquireLock(lockPath, { ttlMs: 10_000 });
    const metadata = await readLockMetadata(lockPath);

    expect(metadata).not.toBeNull();
    expect(metadata?.token).toBe(handle.metadata.token);
    expect(metadata?.token).not.toBe("stale-token");
  });
});

describe("GitWorktreeWorkspaceManager", () => {
  it("creates, promotes, and cleans up candidate workspaces", async () => {
    const repoRoot = await initTempGitRepo();
    const manager = new GitWorktreeWorkspaceManager(repoRoot);
    const workspace = await manager.createWorkspace("candidate-001");

    expect(await pathExists(workspace.workspacePath)).toBe(true);
    expect(await readFile(join(workspace.workspacePath, "draft.md"), "utf8")).toContain("runtime");

    await writeFile(
      join(workspace.workspacePath, "draft.md"),
      "ralph-research improves a draft through measurable iterations.\nJudges compare candidate changes against the baseline.\n",
      "utf8",
    );
    await mkdir(join(workspace.workspacePath, "notes"), { recursive: true });
    await writeFile(join(workspace.workspacePath, "notes", "new.md"), "fresh evidence\n", "utf8");
    await rm(join(workspace.workspacePath, "obsolete.md"));

    const promoted = await manager.promoteWorkspace("candidate-001");

    expect(promoted.copiedPaths).toEqual(["draft.md", "notes/new.md"]);
    expect(promoted.deletedPaths).toEqual(["obsolete.md"]);
    expect(await readFile(join(repoRoot, "draft.md"), "utf8")).toContain("measurable iterations");
    expect(await readFile(join(repoRoot, "notes", "new.md"), "utf8")).toBe("fresh evidence\n");
    expect(await pathExists(join(repoRoot, "obsolete.md"))).toBe(false);

    await manager.cleanupWorkspace("candidate-001");

    expect(await pathExists(workspace.workspacePath)).toBe(false);
    const { stdout } = await execa("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot });
    expect(stdout).not.toContain(workspace.workspacePath);
  });

  it("detects abandoned workspace directories that are not registered worktrees", async () => {
    const repoRoot = await initTempGitRepo();
    const manager = new GitWorktreeWorkspaceManager(repoRoot);
    const active = await manager.createWorkspace("candidate-001");
    const abandonedPath = manager.getWorkspacePath("candidate-orphan");

    await mkdir(abandonedPath, { recursive: true });

    const abandoned = await manager.findAbandonedWorkspaces();

    expect(abandoned).toContain(abandonedPath);
    expect(abandoned).not.toContain(active.workspacePath);

    await manager.cleanupWorkspace("candidate-001");
  });
});

async function initTempGitRepo(): Promise<string> {
  const repoRoot = join(tempRoot, "repo");
  await mkdir(repoRoot, { recursive: true });

  await execa("git", ["init"], { cwd: repoRoot });
  await execa("git", ["config", "user.name", "Ralph Research Tests"], { cwd: repoRoot });
  await execa("git", ["config", "user.email", "tests@example.com"], { cwd: repoRoot });

  await writeFile(
    join(repoRoot, "draft.md"),
    "ralph-research is a local runtime for recursive improvement.\nIt evaluates measurable changes before accepting them.\n",
    "utf8",
  );
  await writeFile(join(repoRoot, "obsolete.md"), "remove me\n", "utf8");

  await execa("git", ["add", "."], { cwd: repoRoot });
  await execa("git", ["commit", "-m", "initial fixture"], { cwd: repoRoot });

  return repoRoot;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
