import type { Command } from "commander";

import { getRunAdmission } from "../../app/services/run-admission-service.js";
import { DEFAULT_MANIFEST_FILENAME } from "../../core/manifest/schema.js";
import type { CommandIO } from "./run.js";

export interface DoctorCommandOptions {
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

export async function runDoctorCommand(
  options: DoctorCommandOptions,
  io: CommandIO = defaultCommandIO,
): Promise<number> {
  try {
    const admission = await getRunAdmission({
      repoRoot: process.cwd(),
      ...(options.path ? { manifestPath: options.path } : {}),
    });

    if (admission.ok) {
      if (options.json) {
        io.stdout(JSON.stringify(admission, null, 2));
      } else {
        io.stdout(`Doctor: manifest is executable: ${admission.path}`);
      }
      return 0;
    }

    if (options.json) {
      io.stderr(JSON.stringify(admission, null, 2));
    } else {
      const details = admission.details ? `\n${JSON.stringify(admission.details, null, 2)}` : "";
      io.stderr(`Doctor: manifest is blocked: ${admission.path}\n${admission.error}${details}`);
    }
    return 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to inspect manifest admission";
    if (options.json) {
      io.stderr(JSON.stringify({ ok: false, executable: false, error: message }, null, 2));
    } else {
      io.stderr(message);
    }
    return 1;
  }
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Show whether the current manifest is executable or blocked before run.")
    .option("-p, --path <path>", "Path to the manifest file", DEFAULT_MANIFEST_FILENAME)
    .option("--json", "Emit machine-readable output", false)
    .action(async (options: DoctorCommandOptions) => {
      const exitCode = await runDoctorCommand(options);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}
