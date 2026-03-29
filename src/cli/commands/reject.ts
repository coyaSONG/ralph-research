import type { Command } from "commander";

import { ManualDecisionService } from "../../app/services/manual-decision-service.js";
import type { CommandIO } from "./run.js";

export interface RejectCommandOptions {
  path?: string;
  note?: string;
  by?: string;
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

export async function runRejectCommand(
  runId: string,
  options: RejectCommandOptions,
  io: CommandIO = defaultCommandIO,
): Promise<number> {
  try {
    const result = await new ManualDecisionService().reject({
      repoRoot: process.cwd(),
      runId,
      ...(options.path ? { manifestPath: options.path } : {}),
      ...(options.note ? { note: options.note } : {}),
      ...(options.by ? { by: options.by } : {}),
    });

    if (options.json) {
      io.stdout(JSON.stringify({ ok: true, result }, null, 2));
    } else {
      io.stdout(`Rejected ${runId}`);
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reject run";
    if (options.json) {
      io.stderr(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      io.stderr(message);
    }
    return 1;
  }
}

export function registerRejectCommand(program: Command): void {
  program
    .command("reject")
    .description("Reject a pending human review run and discard its workspace.")
    .argument("<runId>", "Run identifier")
    .option("-p, --path <path>", "Path to the manifest file")
    .option("--note <note>", "Optional rejection note")
    .option("--by <actor>", "Human actor identifier")
    .option("--json", "Emit machine-readable output", false)
    .action(async (runId: string, options: RejectCommandOptions) => {
      const exitCode = await runRejectCommand(runId, options);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}
