import type { Command } from "commander";

import { getProjectStatus, type ProjectStatus } from "../../app/services/project-state-service.js";
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
      const lines = [
        `manifest: ${status.manifestPath}`,
        `latest run: ${status.latestRun?.runId ?? "none"} (${status.latestRun?.status ?? "n/a"})`,
        `runtime: ${formatRuntimeSummary(status)}`,
        `recovery: ${status.recovery.classification} (${status.recovery.nextAction})`,
      ];
      if (status.runtime.pid !== undefined) {
        lines.push(`pid: ${status.runtime.pid}`);
      }
      if (status.runtime.lastHeartbeatAt) {
        lines.push(`heartbeat: ${status.runtime.lastHeartbeatAt}`);
      }
      if (status.runtime.currentStep !== "none") {
        lines.push(`current step: ${status.runtime.currentStep}`);
      }
      if (status.runtime.currentStepStartedAt) {
        lines.push(`current step started: ${status.runtime.currentStepStartedAt}`);
      }
      if (status.runtime.lastProgressAt) {
        lines.push(`last progress: ${status.runtime.lastProgressAt}`);
      }
      lines.push(`frontier entries: ${status.frontier.length}`);
      lines.push(`pending human: ${status.pendingHumanRuns.length}`);

      io.stdout(
        lines.join("\n"),
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

function formatRuntimeSummary(status: ProjectStatus): string {
  const runtime = status.runtime;

  if (runtime.state === "running") {
    return "running (alive)";
  }

  if (runtime.state === "stale" && runtime.resumable) {
    return "stale (resumable)";
  }

  if (runtime.state === "stopped") {
    return `stopped (${runtime.reason})`;
  }

  return runtime.state;
}
