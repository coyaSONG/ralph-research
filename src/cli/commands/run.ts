import type { Command } from "commander";

import { RunCycleService } from "../../app/services/run-cycle-service.js";

export interface RunCommandOptions {
  path?: string;
  cycles?: number;
  json?: boolean;
  fresh?: boolean;
}

export interface CommandIO {
  stdout(message: string): void;
  stderr(message: string): void;
}

const defaultCommandIO: CommandIO = {
  stdout: (message) => {
    process.stdout.write(`${message}\n`);
  },
  stderr: (message) => {
    process.stderr.write(`${message}\n`);
  },
};

export async function runRunCommand(
  options: RunCommandOptions,
  io: CommandIO = defaultCommandIO,
): Promise<number> {
  try {
    const service = new RunCycleService();
    const cycles = options.cycles ?? 1;
    const results = [];

    for (let index = 0; index < cycles; index += 1) {
      const result = await service.run({
        repoRoot: process.cwd(),
        ...(options.path ? { manifestPath: options.path } : {}),
        ...(options.fresh ? { fresh: options.fresh } : {}),
      });
      results.push(result);

      if (result.warning && !options.json) {
        io.stderr(result.warning);
      }

      if (result.status === "failed") {
        if (options.json) {
          io.stdout(JSON.stringify({ ok: false, results }, null, 2));
        } else {
          io.stderr(`Cycle ${index + 1} ended with status ${result.status}`);
        }
        return 1;
      }
    }

    if (options.json) {
      io.stdout(
        JSON.stringify(
          {
            ok: true,
            cycles,
            results,
          },
          null,
          2,
        ),
      );
    } else {
      const latest = results.at(-1);
      io.stdout(`Completed ${cycles} cycle(s); latest status=${latest?.status ?? "unknown"}`);
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run cycle";
    if (options.json) {
      io.stderr(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      io.stderr(message);
    }
    return 1;
  }
}

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Run one or more research cycles.")
    .option("-p, --path <path>", "Path to the manifest file")
    .option("-c, --cycles <count>", "Number of cycles to run", (value) => Number.parseInt(value, 10), 1)
    .option("--fresh", "Start a fresh run instead of auto-resuming the latest recoverable run", false)
    .option("--json", "Emit machine-readable output", false)
    .action(async (options: RunCommandOptions) => {
      const exitCode = await runRunCommand(options);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}
