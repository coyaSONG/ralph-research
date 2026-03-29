import type { Command } from "commander";

import { getProjectFrontier } from "../../app/services/project-state-service.js";
import type { CommandIO } from "./run.js";

export interface FrontierCommandOptions {
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

export async function runFrontierCommand(
  options: FrontierCommandOptions,
  io: CommandIO = defaultCommandIO,
): Promise<number> {
  try {
    const frontier = await getProjectFrontier({
      repoRoot: process.cwd(),
      ...(options.path ? { manifestPath: options.path } : {}),
    });

    if (options.json) {
      io.stdout(JSON.stringify(frontier, null, 2));
    } else {
      io.stdout(`frontier entries: ${frontier.frontier.length}`);
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load frontier";
    if (options.json) {
      io.stderr(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      io.stderr(message);
    }
    return 1;
  }
}

export function registerFrontierCommand(program: Command): void {
  program
    .command("frontier")
    .description("Show the current frontier.")
    .option("-p, --path <path>", "Path to the manifest file")
    .option("--json", "Emit machine-readable output", false)
    .action(async (options: FrontierCommandOptions) => {
      const exitCode = await runFrontierCommand(options);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}
