import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { Command } from "commander";
import { execa } from "execa";

import { loadManifestFromFile } from "../../adapters/fs/manifest-loader.js";
import { DEFAULT_MANIFEST_FILENAME } from "../../core/manifest/schema.js";
import { copyTemplate } from "../../shared/template-utils.js";
import type { CommandIO } from "./run.js";

export interface InitCommandOptions {
  template: string;
  path?: string;
  force?: boolean;
  json?: boolean;
}

const defaultCommandIO: CommandIO = {
  stdout: (message) => {
    process.stdout.write(`${message}\n`);
  },
  stderr: (message) => {
    process.stderr.write(`${message}\n`);
  },
};

export async function runInitCommand(
  options: InitCommandOptions,
  io: CommandIO = defaultCommandIO,
): Promise<number> {
  try {
    const targetDir = resolve(options.path ?? process.cwd());
    await mkdir(targetDir, { recursive: true });

    const copied = await copyTemplate(options.template, targetDir, {
      ...(options.force === undefined ? {} : { force: options.force }),
    });
    const manifestPath = resolve(targetDir, DEFAULT_MANIFEST_FILENAME);
    const manifest = await loadManifestFromFile(manifestPath);
    const initializedGit = await ensureRunnableGitRepo(targetDir, `rrx: init ${options.template} template`);

    if (options.json) {
      io.stdout(
        JSON.stringify(
          {
            ok: true,
            template: options.template,
            targetDir,
            copiedFiles: copied.copiedFiles,
            manifestPath: manifest.path,
            project: manifest.manifest.project.name,
            initializedGit,
          },
          null,
          2,
        ),
      );
    } else {
      io.stdout(
        [
          `Initialized ${options.template} template in ${targetDir}`,
          `Manifest: ${manifest.path}`,
          initializedGit ? "Git: initialized runnable repository with first commit" : "Git: reused existing repository",
          "Next: rrx run --json",
        ].join("\n"),
      );
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to initialize template";
    if (options.json) {
      io.stderr(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      io.stderr(message);
    }
    return 1;
  }
}

async function ensureRunnableGitRepo(repoRoot: string, message: string): Promise<boolean> {
  const insideGitRepo = await isInsideGitRepo(repoRoot);
  if (!insideGitRepo) {
    await execa("git", ["init"], { cwd: repoRoot });
  }

  await ensureGitIdentity(repoRoot);

  const hasHead = await hasGitHead(repoRoot);
  if (!hasHead) {
    await execa("git", ["add", "."], { cwd: repoRoot });
    await execa("git", ["commit", "-m", message], { cwd: repoRoot });
  }

  return !insideGitRepo || !hasHead;
}

async function isInsideGitRepo(repoRoot: string): Promise<boolean> {
  try {
    await execa("git", ["rev-parse", "--is-inside-work-tree"], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

async function hasGitHead(repoRoot: string): Promise<boolean> {
  try {
    await execa("git", ["rev-parse", "--verify", "HEAD"], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

async function ensureGitIdentity(repoRoot: string): Promise<void> {
  const name = await readGitConfig(repoRoot, "user.name");
  if (!name) {
    await execa("git", ["config", "user.name", "ralph-research"], { cwd: repoRoot });
  }

  const email = await readGitConfig(repoRoot, "user.email");
  if (!email) {
    await execa("git", ["config", "user.email", "rrx@example.invalid"], { cwd: repoRoot });
  }
}

async function readGitConfig(repoRoot: string, key: string): Promise<string | null> {
  try {
    const { stdout } = await execa("git", ["config", "--get", key], { cwd: repoRoot });
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Copy a starter template into the current directory or a target path.")
    .requiredOption("--template <name>", "Template name", "writing")
    .option("-p, --path <path>", "Destination directory", process.cwd())
    .option("--force", "Overwrite existing files when needed", false)
    .option("--json", "Emit machine-readable output", false)
    .action(async (options: InitCommandOptions) => {
      const exitCode = await runInitCommand(options);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}
