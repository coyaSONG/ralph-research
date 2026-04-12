import { Command } from "commander";

import { registerAcceptCommand } from "./commands/accept.js";
import { registerDemoCommand } from "./commands/demo.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerFrontierCommand } from "./commands/frontier.js";
import { registerInitCommand } from "./commands/init.js";
import { registerInspectCommand } from "./commands/inspect.js";
import {
  registerLaunchCommand,
  runLaunchCommand as defaultLaunchCommand,
} from "./commands/launch.js";
import { registerRejectCommand } from "./commands/reject.js";
import {
  registerResumeCommand,
  runResumeCommand as defaultResumeCommand,
} from "./commands/resume.js";
import { registerRunCommand, runRunCommand as defaultRunCommand } from "./commands/run.js";
import { registerServeMcpCommand } from "./commands/serve-mcp.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerValidateCommand } from "./commands/validate.js";

type LaunchCommandHandler = typeof defaultLaunchCommand;
type ResumeCommandHandler = typeof defaultResumeCommand;
type RunCommandHandler = typeof defaultRunCommand;

export interface CliDependencies {
  launchCommand?: LaunchCommandHandler;
  resumeCommand?: ResumeCommandHandler;
  runCommand?: RunCommandHandler;
}

export function createProgram(dependencies: CliDependencies = {}): Command {
  const program = new Command();
  const launchCommand = dependencies.launchCommand ?? defaultLaunchCommand;

  program
    .name("rrx")
    .description("Local-first runtime for recursive research improvement.")
    .version("0.1.3")
    .argument("[goal]", "Goal to pursue through the v1 TUI research orchestrator")
    .action(async (goal?: string) => {
      if (goal === undefined) {
        program.outputHelp();
        return;
      }

      const exitCode = await launchCommand(goal, {
        repoRoot: process.cwd(),
      });
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });

  registerDoctorCommand(program);
  registerValidateCommand(program);
  registerInitCommand(program);
  registerDemoCommand(program);
  registerLaunchCommand(program, launchCommand);
  registerResumeCommand(program, dependencies.resumeCommand);
  registerRunCommand(program, dependencies.runCommand);
  registerStatusCommand(program);
  registerFrontierCommand(program);
  registerInspectCommand(program);
  registerAcceptCommand(program);
  registerRejectCommand(program);
  registerServeMcpCommand(program);

  return program;
}

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<void> {
  const program = createProgram(dependencies);
  await program.parseAsync(argv);
}
