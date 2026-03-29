import type { Command } from "commander";

import { startMcpServer } from "../../mcp/server.js";
import type { CommandIO } from "./run.js";

export interface ServeMcpCommandOptions {
  stdio?: boolean;
}

const defaultCommandIO: CommandIO = {
  stdout: (message) => {
    process.stdout.write(`${message}\n`);
  },
  stderr: (message) => {
    process.stderr.write(`${message}\n`);
  },
};

export async function runServeMcpCommand(
  options: ServeMcpCommandOptions,
  io: CommandIO = defaultCommandIO,
): Promise<number> {
  if (options.stdio === false) {
    io.stderr("Only stdio transport is supported in v0.1");
    return 1;
  }

  await startMcpServer({
    repoRoot: process.cwd(),
  });

  return 0;
}

export function registerServeMcpCommand(program: Command): void {
  program
    .command("serve-mcp")
    .description("Start the minimal MCP server over stdio.")
    .option("--stdio", "Use stdio transport", true)
    .action(async (options: ServeMcpCommandOptions) => {
      const exitCode = await runServeMcpCommand(options);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}
