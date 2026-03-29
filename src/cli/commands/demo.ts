import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { Command } from "commander";
import { execa } from "execa";

import { inspectRun } from "../../app/services/project-state-service.js";
import { RunCycleService } from "../../app/services/run-cycle-service.js";
import { DEFAULT_MANIFEST_FILENAME } from "../../core/manifest/schema.js";
import { copyTemplate } from "../../shared/template-utils.js";
import type { CommandIO } from "./run.js";

export interface DemoCommandOptions {
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

export async function runDemoCommand(
  template: string,
  options: DemoCommandOptions,
  io: CommandIO = defaultCommandIO,
): Promise<number> {
  if (template !== "writing") {
    const message = `Unsupported demo template ${template}; only writing is available in v0.1`;
    if (options.json) {
      io.stderr(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      io.stderr(message);
    }
    return 1;
  }

  try {
    const targetDir = options.path
      ? resolve(options.path)
      : await mkdtemp(join(tmpdir(), "rrx-demo-writing-"));
    if (options.force) {
      await rm(targetDir, { recursive: true, force: true });
    }
    await mkdir(targetDir, { recursive: true });

    await copyTemplate(template, targetDir, {
      ...(options.force === undefined ? {} : { force: options.force }),
    });
    await initializeDemoRepo(targetDir);

    const service = new RunCycleService();
    const result = await service.run({
      repoRoot: targetDir,
      manifestPath: join(targetDir, DEFAULT_MANIFEST_FILENAME),
    });

    const runId = result.runResult?.run.runId;
    if (!runId) {
      throw new Error(`Demo run did not produce a run record; status=${result.status}`);
    }

    const inspection = await inspectRun({
      repoRoot: targetDir,
      manifestPath: join(targetDir, DEFAULT_MANIFEST_FILENAME),
      runId,
    });

    if (options.json) {
      io.stdout(
        JSON.stringify(
          {
            ok: true,
            template,
            targetDir,
            status: result.status,
            runId,
            inspect: inspection.explainability,
          },
          null,
          2,
        ),
      );
    } else {
      io.stdout(
        [
          `Demo created at ${targetDir}`,
          `Cycle status: ${result.status}`,
          `Run: ${runId}`,
          `Decision: ${inspection.explainability.decisionReason ?? "n/a"}`,
          `Next: cd ${targetDir} && rrx inspect ${runId} --json`,
        ].join("\n"),
      );
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run demo";
    if (options.json) {
      io.stderr(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      io.stderr(message);
    }
    return 1;
  }
}

export function registerDemoCommand(program: Command): void {
  program
    .command("demo")
    .description("Create and run a zero-config demo.")
    .argument("<template>", "Demo template name")
    .option("-p, --path <path>", "Destination directory")
    .option("--force", "Replace the destination directory if it already exists", false)
    .option("--json", "Emit machine-readable output", false)
    .action(async (template: string, options: DemoCommandOptions) => {
      const exitCode = await runDemoCommand(template, options);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}

async function initializeDemoRepo(repoRoot: string): Promise<void> {
  await execa("git", ["init"], { cwd: repoRoot });
  await execa("git", ["config", "user.name", "research-ratchet demo"], { cwd: repoRoot });
  await execa("git", ["config", "user.email", "demo@example.com"], { cwd: repoRoot });
  await execa("git", ["add", "."], { cwd: repoRoot });
  await execa("git", ["commit", "-m", "demo fixture"], { cwd: repoRoot });
}
