import type { Command } from "commander";

import { ManualDecisionService } from "../../app/services/manual-decision-service.js";
import type { CommandIO } from "./run.js";

export interface AcceptCommandOptions {
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

export async function runAcceptCommand(
  runId: string,
  options: AcceptCommandOptions,
  io: CommandIO = defaultCommandIO,
): Promise<number> {
  try {
    const result = await new ManualDecisionService().accept({
      repoRoot: process.cwd(),
      runId,
      ...(options.path ? { manifestPath: options.path } : {}),
      ...(options.note ? { note: options.note } : {}),
      ...(options.by ? { by: options.by } : {}),
    });

    if (options.json) {
      io.stdout(JSON.stringify({ ok: true, result }, null, 2));
    } else {
      io.stdout(`Accepted ${runId}${result.decision.commitSha ? ` at ${result.decision.commitSha}` : ""}`);
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to accept run";
    if (options.json) {
      io.stderr(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      io.stderr(message);
    }
    return 1;
  }
}

export function registerAcceptCommand(program: Command): void {
  program
    .command("accept")
    .description("Accept a pending human review run and promote it to the frontier.")
    .argument("<runId>", "Run identifier")
    .option("-p, --path <path>", "Path to the manifest file")
    .option("--note <note>", "Optional acceptance note")
    .option("--by <actor>", "Human actor identifier")
    .option("--json", "Emit machine-readable output", false)
    .action(async (runId: string, options: AcceptCommandOptions) => {
      const exitCode = await runAcceptCommand(runId, options);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}
