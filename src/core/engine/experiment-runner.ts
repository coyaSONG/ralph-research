import { resolve } from "node:path";

import { execaCommand } from "execa";

import type { CommandSpecConfig } from "../manifest/schema.js";

export interface RunExperimentInput {
  workspacePath: string;
  env?: Record<string, string>;
}

export interface ExperimentRunResult {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function runExperiment(
  config: CommandSpecConfig,
  input: RunExperimentInput,
): Promise<ExperimentRunResult> {
  const cwd = config.cwd ? resolve(input.workspacePath, config.cwd) : resolve(input.workspacePath);
  const startedAt = Date.now();
  const result = await execaCommand(config.command, {
    cwd,
    env: { ...process.env, ...config.env, ...input.env },
    reject: false,
    shell: true,
    timeout: config.timeoutSec * 1_000,
  });

  if (result.exitCode !== 0) {
    throw new Error(`experiment command failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`);
  }

  return {
    command: config.command,
    cwd,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: Date.now() - startedAt,
  };
}
