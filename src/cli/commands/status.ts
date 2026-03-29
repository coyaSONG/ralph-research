import type { Command } from "commander";

import { getProjectStatus } from "../../app/services/project-state-service.js";
import type { CommandIO } from "./run.js";

export interface StatusCommandOptions {
  path?: string;
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

export async function runStatusCommand(
  options: StatusCommandOptions,
  io: CommandIO = defaultCommandIO,
): Promise<number> {
  try {
    const status = await getProjectStatus({
      repoRoot: process.cwd(),
      ...(options.path ? { manifestPath: options.path } : {}),
    });

    if (options.json) {
      io.stdout(JSON.stringify(status, null, 2));
    } else {
      io.stdout(
        [
          `manifest: ${status.manifestPath}`,
          `latest run: ${status.latestRun?.runId ?? "none"} (${status.latestRun?.status ?? "n/a"})`,
          `frontier entries: ${status.frontier.length}`,
          `pending human: ${status.pendingHumanRuns.length}`,
        ].join("\n"),
      );
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load project status";
    if (options.json) {
      io.stderr(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      io.stderr(message);
    }
    return 1;
  }
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show project status, current frontier, and pending human review.")
    .option("-p, --path <path>", "Path to the manifest file")
    .option("--json", "Emit machine-readable output", false)
    .action(async (options: StatusCommandOptions) => {
      const exitCode = await runStatusCommand(options);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}
