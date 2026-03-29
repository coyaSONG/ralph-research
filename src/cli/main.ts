#!/usr/bin/env node

import { Command } from "commander";

import { createAppContext } from "../app/context.js";
import { registerAcceptCommand } from "./commands/accept.js";
import { registerDemoCommand } from "./commands/demo.js";
import { registerFrontierCommand } from "./commands/frontier.js";
import { registerInitCommand } from "./commands/init.js";
import { registerInspectCommand } from "./commands/inspect.js";
import { registerRejectCommand } from "./commands/reject.js";
import { registerRunCommand } from "./commands/run.js";
import { registerServeMcpCommand } from "./commands/serve-mcp.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerValidateCommand } from "./commands/validate.js";
import { logger } from "../shared/logger.js";

const program = new Command();

program
  .name("rrx")
  .description("Local-first runtime for recursive research improvement.")
  .version("0.1.0");

program
  .command("doctor")
  .description("Print scaffold status.")
  .action(() => {
    const context = createAppContext();
    logger.info({ appName: context.appName, phase: context.phase }, "scaffold ready");
  });

registerValidateCommand(program);
registerInitCommand(program);
registerDemoCommand(program);
registerRunCommand(program);
registerStatusCommand(program);
registerFrontierCommand(program);
registerInspectCommand(program);
registerAcceptCommand(program);
registerRejectCommand(program);
registerServeMcpCommand(program);

await program.parseAsync(process.argv);
