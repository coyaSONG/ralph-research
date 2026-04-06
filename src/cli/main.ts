#!/usr/bin/env node

import { Command } from "commander";

import { registerAcceptCommand } from "./commands/accept.js";
import { registerDemoCommand } from "./commands/demo.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerFrontierCommand } from "./commands/frontier.js";
import { registerInitCommand } from "./commands/init.js";
import { registerInspectCommand } from "./commands/inspect.js";
import { registerRejectCommand } from "./commands/reject.js";
import { registerRunCommand } from "./commands/run.js";
import { registerServeMcpCommand } from "./commands/serve-mcp.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerValidateCommand } from "./commands/validate.js";

const program = new Command();

program
  .name("rrx")
  .description("Local-first runtime for recursive research improvement.")
  .version("0.1.2");

registerDoctorCommand(program);
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
