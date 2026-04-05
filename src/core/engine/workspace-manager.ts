import { copyFile, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { execa } from "execa";

import { isMissingFileError } from "../../shared/fs-errors.js";

export interface WorkspaceInfo {
  candidateId: string;
  repoRoot: string;
  workspaceRoot: string;
  workspacePath: string;
}

export interface PromoteWorkspaceResult {
  candidateId: string;
  workspacePath: string;
  copiedPaths: string[];
  deletedPaths: string[];
}

export interface PromotionBundle {
  candidateId: string;
  workspacePath: string;
  patch: string;
  changedPaths: string[];
  deletedPaths: string[];
}

export interface PromoteWorkspaceOptions {
  excludePaths?: string[];
}

interface WorktreeDescriptor {
  path: string;
}

export class GitWorktreeWorkspaceManager {
  private readonly repoRoot: string;
  private readonly ralphRoot: string;
  private readonly workspaceRoot: string;

  public constructor(repoRoot: string, ralphRoot = join(repoRoot, ".ralph")) {
    this.repoRoot = resolve(repoRoot);
    this.ralphRoot = resolve(ralphRoot);
    this.workspaceRoot = join(this.ralphRoot, "workspaces");
  }

  public async createWorkspace(candidateId: string, baselineRef = "HEAD"): Promise<WorkspaceInfo> {
    await this.ensureGitRepo();

    const workspacePath = this.getWorkspacePath(candidateId);
    const existingWorktree = await this.findRegisteredWorktree(workspacePath);
    if (existingWorktree) {
      return this.buildWorkspaceInfo(candidateId, workspacePath);
    }

    await mkdir(this.workspaceRoot, { recursive: true });
    await execa("git", ["-C", this.repoRoot, "worktree", "add", "--detach", workspacePath, baselineRef]);
    return this.buildWorkspaceInfo(candidateId, workspacePath);
  }

  public async promoteWorkspace(
    candidateId: string,
    options: PromoteWorkspaceOptions = {},
  ): Promise<PromoteWorkspaceResult> {
    await this.ensureGitRepo();

    const workspacePath = this.getWorkspacePath(candidateId);
    const excludedPaths = new Set((options.excludePaths ?? []).map(normalizeRelativePath));
    const modifiedPaths = (await this.readCommandLines(workspacePath, ["diff", "--name-only", "HEAD"])).filter(
      (path) => !excludedPaths.has(normalizeRelativePath(path)),
    );
    const deletedPaths = (
      await this.readCommandLines(workspacePath, ["diff", "--name-only", "--diff-filter=D", "HEAD"])
    ).filter((path) => !excludedPaths.has(normalizeRelativePath(path)));
    const untrackedPaths = (await this.readCommandLines(workspacePath, ["ls-files", "--others", "--exclude-standard"])).filter(
      (path) => !excludedPaths.has(normalizeRelativePath(path)),
    );

    const copied = new Set<string>();

    for (const relativePath of [...modifiedPaths, ...untrackedPaths]) {
      if (!relativePath || deletedPaths.includes(relativePath)) {
        continue;
      }

      const sourcePath = join(workspacePath, relativePath);
      const targetPath = join(this.repoRoot, relativePath);
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
      copied.add(relativePath);
    }

    for (const relativePath of deletedPaths) {
      if (!relativePath) {
        continue;
      }
      await rm(join(this.repoRoot, relativePath), { force: true });
    }

    return {
      candidateId,
      workspacePath,
      copiedPaths: [...copied].sort(),
      deletedPaths: deletedPaths.sort(),
    };
  }

  public async preparePromotionBundle(
    candidateId: string,
    options: PromoteWorkspaceOptions = {},
  ): Promise<PromotionBundle> {
    await this.ensureGitRepo();

    const workspacePath = this.getWorkspacePath(candidateId);
    const excludedPaths = (options.excludePaths ?? []).map(normalizeRelativePath);
    const { changedPaths, deletedPaths } = await this.collectWorkspaceChanges(workspacePath, excludedPaths);
    const tempRoot = await mkdtemp(join(this.ralphRoot, "promotion-"));
    const repoSnapshotRoot = join(tempRoot, "repo");
    const candidateSnapshotRoot = join(tempRoot, "candidate");

    await mkdir(repoSnapshotRoot, { recursive: true });
    await mkdir(candidateSnapshotRoot, { recursive: true });

    try {
      for (const relativePath of changedPaths) {
        await copyPathIfPresent(join(this.repoRoot, relativePath), join(repoSnapshotRoot, relativePath));
        await copyPathIfPresent(join(workspacePath, relativePath), join(candidateSnapshotRoot, relativePath));
      }

      const diff = await execa(
        "git",
        ["diff", "--no-index", "--binary", "--src-prefix=a/", "--dst-prefix=b/", "repo", "candidate"],
        {
          cwd: tempRoot,
          reject: false,
        },
      );
      if (diff.exitCode !== 0 && diff.exitCode !== 1) {
        throw new Error(diff.stderr || "failed to build promotion patch");
      }

      return {
        candidateId,
        workspacePath,
        patch: ensureTrailingNewline(diff.stdout),
        changedPaths,
        deletedPaths,
      };
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  public async cleanupWorkspace(candidateId: string): Promise<void> {
    await this.ensureGitRepo();

    const workspacePath = this.getWorkspacePath(candidateId);
    const registeredWorktree = await this.findRegisteredWorktree(workspacePath);

    if (registeredWorktree) {
      await execa("git", ["-C", this.repoRoot, "worktree", "remove", "--force", workspacePath]);
    }

    await rm(workspacePath, { recursive: true, force: true });
  }

  public async findAbandonedWorkspaces(): Promise<string[]> {
    await this.ensureGitRepo();
    const registeredPaths = new Set(await Promise.all((await this.listWorktrees()).map((worktree) => this.canonicalizePath(worktree.path))));

    try {
      const entries = await readdir(this.workspaceRoot, { withFileTypes: true });
      const candidates = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            const path = resolve(join(this.workspaceRoot, entry.name));
            return {
              path,
              canonicalPath: await this.canonicalizePath(path),
            };
          }),
      );

      return candidates
        .filter((candidate) => !registeredPaths.has(candidate.canonicalPath))
        .map((candidate) => candidate.path)
        .sort();
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }
  }

  public getWorkspacePath(candidateId: string): string {
    return join(this.workspaceRoot, candidateId);
  }

  private buildWorkspaceInfo(candidateId: string, workspacePath: string): WorkspaceInfo {
    return {
      candidateId,
      repoRoot: this.repoRoot,
      workspaceRoot: this.workspaceRoot,
      workspacePath,
    };
  }

  private async ensureGitRepo(): Promise<void> {
    await execa("git", ["-C", this.repoRoot, "rev-parse", "--is-inside-work-tree"]);
  }

  private async listWorktrees(): Promise<WorktreeDescriptor[]> {
    const { stdout } = await execa("git", ["-C", this.repoRoot, "worktree", "list", "--porcelain"]);
    return stdout
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => ({ path: resolve(line.slice("worktree ".length).trim()) }));
  }

  private async findRegisteredWorktree(workspacePath: string): Promise<WorktreeDescriptor | null> {
    const resolvedPath = await this.canonicalizePath(workspacePath);
    const worktrees = await this.listWorktrees();

    for (const worktree of worktrees) {
      if ((await this.canonicalizePath(worktree.path)) === resolvedPath) {
        return worktree;
      }
    }

    return null;
  }

  private async readCommandLines(cwd: string, gitArgs: string[]): Promise<string[]> {
    const { stdout } = await execa("git", ["-C", cwd, ...gitArgs]);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => relative(resolve(cwd), resolve(join(cwd, line))));
  }

  private async canonicalizePath(path: string): Promise<string> {
    try {
      return await realpath(path);
    } catch (error) {
      if (isMissingFileError(error)) {
        return resolve(path);
      }
      throw error;
    }
  }

  private async collectWorkspaceChanges(
    workspacePath: string,
    excludedPaths: string[],
  ): Promise<{
    changedPaths: string[];
    deletedPaths: string[];
  }> {
    await execa("git", ["-C", workspacePath, "add", "-A", "--", "."]);

    try {
      if (excludedPaths.length > 0) {
        await execa("git", ["-C", workspacePath, "reset", "HEAD", "--", ...excludedPaths]);
      }

      return {
        changedPaths: await this.readCommandLines(workspacePath, ["diff", "--name-only", "--cached", "HEAD"]),
        deletedPaths: await this.readCommandLines(
          workspacePath,
          ["diff", "--name-only", "--cached", "--diff-filter=D", "HEAD"],
        ),
      };
    } finally {
      await execa("git", ["-C", workspacePath, "reset", "HEAD", "--", "."]);
    }
  }
}

function normalizeRelativePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function ensureTrailingNewline(value: string): string {
  if (value.length === 0 || value.endsWith("\n")) {
    return value;
  }

  return `${value}\n`;
}

async function copyPathIfPresent(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }
}
