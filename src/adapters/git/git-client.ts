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
}
