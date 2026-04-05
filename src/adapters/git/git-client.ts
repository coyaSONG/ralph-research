import { execa } from "execa";

export interface CommitResult {
  commitSha: string;
}

export class GitClient {
  private readonly repoRoot: string;

  public constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  public async stageAndCommitPaths(paths: string[], message: string): Promise<CommitResult> {
    const uniquePaths = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
    if (uniquePaths.length === 0) {
      throw new Error("Refusing to create an acceptance commit with no promoted paths");
    }

    await execa("git", ["-C", this.repoRoot, "add", "-A", "--", ...uniquePaths]);
    await execa("git", ["-C", this.repoRoot, "commit", "-m", message]);
    return {
      commitSha: await this.getHeadSha(),
    };
  }

  public async getHeadSha(): Promise<string> {
    const { stdout } = await execa("git", ["-C", this.repoRoot, "rev-parse", "HEAD"]);
    return stdout.trim();
  }

  public async applyPatchIfNeeded(patchPath: string): Promise<"applied" | "already_applied"> {
    if (await this.canApplyPatch(["apply", "--check", "--3way", "--index", "-p2", patchPath])) {
      await execa("git", ["-C", this.repoRoot, "apply", "--3way", "--index", "-p2", patchPath]);
      return "applied";
    }

    if (await this.canApplyPatch(["apply", "--check", "--reverse", "--index", "-p2", patchPath])) {
      return "already_applied";
    }

    throw new Error(`repository state diverged from durable promotion patch ${patchPath}`);
  }

  private async canApplyPatch(args: string[]): Promise<boolean> {
    try {
      await execa("git", ["-C", this.repoRoot, ...args]);
      return true;
    } catch {
      return false;
    }
  }
}
