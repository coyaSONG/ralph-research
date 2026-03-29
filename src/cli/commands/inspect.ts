import type { Command } from "commander";

import { RunNotFoundError, inspectRun } from "../../app/services/project-state-service.js";
import type { CommandIO } from "./run.js";

export interface InspectCommandOptions {
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

export async function runInspectCommand(
  runId: string,
  options: InspectCommandOptions,
  io: CommandIO = defaultCommandIO,
): Promise<number> {
  try {
    const result = await inspectRun({
      repoRoot: process.cwd(),
      runId,
      ...(options.path ? { manifestPath: options.path } : {}),
    });

    if (options.json) {
      io.stdout(JSON.stringify(result, null, 2));
    } else {
      io.stdout(
        [
          `run: ${result.run.runId} (${result.run.status})`,
          `decision: ${result.decision?.outcome ?? "n/a"}`,
          `reason: ${result.explainability.decisionReason ?? "n/a"}`,
          `judge rationales: ${result.explainability.judgeRationales.length}`,
        ].join("\n"),
      );
    }

    return 0;
  } catch (error) {
    const message = error instanceof RunNotFoundError ? error.message : "Failed to inspect run";
    if (options.json) {
      io.stderr(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      io.stderr(message);
    }
    return 1;
  }
}

export function registerInspectCommand(program: Command): void {
  program
    .command("inspect")
    .description("Inspect a run with diff, metrics, and decision rationale.")
    .argument("<runId>", "Run identifier")
    .option("-p, --path <path>", "Path to the manifest file")
    .option("--json", "Emit machine-readable output", false)
    .action(async (runId: string, options: InspectCommandOptions) => {
      const exitCode = await runInspectCommand(runId, options);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}
