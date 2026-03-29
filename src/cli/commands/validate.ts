import type { Command } from "commander";

import { loadManifestFromFile, ManifestLoadError } from "../../adapters/fs/manifest-loader.js";
import { DEFAULT_MANIFEST_FILENAME } from "../../core/manifest/schema.js";

export interface ValidateCommandOptions {
  path: string;
  json?: boolean;
}

export interface ValidateCommandIO {
  stdout(message: string): void;
  stderr(message: string): void;
}

const defaultValidateCommandIO: ValidateCommandIO = {
  stdout: (message) => {
    process.stdout.write(`${message}\n`);
  },
  stderr: (message) => {
    process.stderr.write(`${message}\n`);
  },
};

export async function runValidateCommand(
  options: ValidateCommandOptions,
  io: ValidateCommandIO = defaultValidateCommandIO,
): Promise<number> {
  try {
    const loaded = await loadManifestFromFile(options.path);

    if (options.json) {
      io.stdout(
        JSON.stringify(
          {
            ok: true,
            path: loaded.path,
            project: loaded.manifest.project.name,
            schemaVersion: loaded.manifest.schemaVersion,
          },
          null,
          2,
        ),
      );
    } else {
      io.stdout(`Manifest is valid: ${loaded.path}`);
    }

    return 0;
  } catch (error) {
    const message = error instanceof ManifestLoadError ? error.message : "Unknown validation error";
    const details = error instanceof ManifestLoadError && error.causeValue ? `\n${JSON.stringify(error.causeValue, null, 2)}` : "";

    if (options.json) {
      io.stderr(
        JSON.stringify(
          {
            ok: false,
            error: message,
            details: error instanceof ManifestLoadError ? error.causeValue : undefined,
          },
          null,
          2,
        ),
      );
    } else {
      io.stderr(`${message}${details}`);
    }

    return 1;
  }
}

export function registerValidateCommand(program: Command): void {
  program
    .command("validate")
    .description("Validate a ralph-research manifest.")
    .option("-p, --path <path>", "Path to the manifest file", DEFAULT_MANIFEST_FILENAME)
    .option("--json", "Emit machine-readable output", false)
    .action(async (options: ValidateCommandOptions) => {
      const exitCode = await runValidateCommand(options);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}
