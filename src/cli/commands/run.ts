import { InvalidArgumentError, type Command } from "commander";

import { RunLoopService } from "../../app/services/run-loop-service.js";

export interface RunCommandOptions {
  path?: string;
  cycles?: number;
  json?: boolean;
  fresh?: boolean;
  untilTarget?: boolean;
  untilNoImprove?: number;
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
    const service = new RunLoopService();
    const result = await service.run({
      repoRoot: process.cwd(),
      ...(options.path ? { manifestPath: options.path } : {}),
      ...(options.fresh ? { fresh: options.fresh } : {}),
      ...(options.cycles === undefined ? {} : { cycles: options.cycles }),
      ...(options.untilTarget ? { untilTarget: options.untilTarget } : {}),
      ...(options.untilNoImprove === undefined ? {} : { untilNoImprove: options.untilNoImprove }),
    });

    if (!options.json) {
      for (const warning of result.warnings) {
        io.stderr(warning);
      }
    }

    if (options.json) {
      io.stdout(
        JSON.stringify(
          {
            ok: result.ok,
            cycles: result.cycles,
            cyclesExecuted: result.cyclesExecuted,
            stopReason: result.stopReason,
            warnings: result.warnings,
            ...(result.target ? { target: result.target } : {}),
            results: result.results,
          },
          null,
          2,
        ),
      );
    } else {
      const latest = result.results.at(-1);
      io.stdout(
        [
          `Executed ${result.cyclesExecuted} cycle(s); latest status=${latest?.status ?? "not_run"}`,
          `stop: ${result.stopReason}`,
        ].join("\n"),
      );
    }

    return result.ok ? 0 : 1;
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

function parsePositiveIntegerOption(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new InvalidArgumentError("requires a positive integer");
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new InvalidArgumentError("requires a positive integer");
  }

  return parsed;
}

export function registerRunCommand(
  program: Command,
  executeRunCommand: typeof runRunCommand = runRunCommand,
): void {
  program
    .command("run")
    .description("Run one or more research cycles or keep iterating until a stop condition is met.")
    .option("-p, --path <path>", "Path to the manifest file")
    .option("-c, --cycles <count>", "Exact cycle count, or a max-cycle cap when used with progressive stop flags", parsePositiveIntegerOption)
    .option("--until-target", "Keep running until manifest.stopping.target is met", false)
    .option("--until-no-improve <count>", "Stop after N consecutive cycles without frontier improvement", parsePositiveIntegerOption)
    .option("--fresh", "Start a fresh run instead of auto-resuming the latest recoverable run", false)
    .option("--json", "Emit machine-readable output", false)
    .action(async (options: RunCommandOptions) => {
      const exitCode = await executeRunCommand(options);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}
