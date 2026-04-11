import type { Command } from "commander";

import type { CommandIO } from "./run.js";

import { ResearchSessionLaunchService } from "../../app/services/research-session-launch-service.js";
import { runResumeCommand } from "./resume.js";
import {
  openResearchSessionShell,
  type ResearchSessionShell,
  type ResearchSessionShellEntrySelection,
} from "../tui/research-session-shell.js";

export interface LaunchCommandOptions {
  repoRoot?: string;
  json?: boolean;
}

export interface LaunchCommandDependencies {
  launchService?: Pick<ResearchSessionLaunchService, "launch">;
  openShell?: ResearchSessionShell;
  resumeCommand?: typeof runResumeCommand;
}

const defaultCommandIO: CommandIO = {
  stdout: (message) => {
    process.stdout.write(`${message}\n`);
  },
  stderr: (message) => {
    process.stderr.write(`${message}\n`);
  },
};

export async function runLaunchCommand(
  goal: string | undefined,
  options: LaunchCommandOptions = {},
  io: CommandIO = defaultCommandIO,
  dependencies: LaunchCommandDependencies = {},
): Promise<number> {
  try {
    const service = dependencies.launchService ?? new ResearchSessionLaunchService();
    const result = await service.launch({
      goal: goal ?? "",
      repoRoot: options.repoRoot ?? process.cwd(),
    });

    if (options.json) {
      io.stdout(JSON.stringify(result, null, 2));
    } else {
      const openShell = dependencies.openShell ?? openResearchSessionShell;
      const shellResult = await openShell(result, io);
      const resumeSelection = resolveResumeSelection(shellResult);
      if (resumeSelection) {
        const resumeCommand = dependencies.resumeCommand ?? runResumeCommand;
        return resumeCommand(
          resumeSelection.sessionId,
          {
            repoRoot: result.repoRoot,
          },
          io,
        );
      }
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to launch research session";
    if (options.json) {
      io.stderr(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      io.stderr(message);
    }
    return 1;
  }
}

function resolveResumeSelection(
  shellResult: ResearchSessionShellEntrySelection | void,
): ResearchSessionShellEntrySelection | undefined {
  if (!shellResult) {
    return undefined;
  }

  return shellResult.entrySelection === "resume" ? shellResult : undefined;
}

export function registerLaunchCommand(
  program: Command,
  executeLaunchCommand: typeof runLaunchCommand = runLaunchCommand,
): void {
  program
    .command("launch")
    .description("Create or refresh the v1 orchestrated research session and open the TUI shell.")
    .argument("<goal>", "Goal to pursue through the v1 TUI research orchestrator")
    .option("--json", "Emit machine-readable output instead of opening the TUI shell", false)
    .action(async (goal: string, options: LaunchCommandOptions) => {
      const exitCode = await executeLaunchCommand(goal, {
        ...options,
        repoRoot: process.cwd(),
      });
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}
