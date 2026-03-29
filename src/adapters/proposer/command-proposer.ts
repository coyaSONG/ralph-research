import { resolve } from "node:path";

import { execaCommand } from "execa";

import type { CommandProposerConfig } from "../../core/manifest/schema.js";

export interface RunCommandProposerInput {
  workspacePath: string;
  env?: Record<string, string>;
}

export interface CommandProposalResult {
  proposerType: "command";
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  summary: string;
  durationMs: number;
}

export async function runCommandProposer(
  config: CommandProposerConfig,
  input: RunCommandProposerInput,
): Promise<CommandProposalResult> {
  const cwd = resolveConfiguredCwd(input.workspacePath, config.cwd);
  const startedAt = Date.now();
  const result = await execaCommand(config.command, {
    cwd,
    env: { ...process.env, ...config.env, ...input.env },
    reject: false,
    shell: true,
    timeout: config.timeoutSec * 1_000,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `command proposer failed with exit code ${result.exitCode}: ${result.stderr || result.stdout || config.command}`,
    );
  }

  return {
    proposerType: "command",
    command: config.command,
    cwd,
    stdout: result.stdout,
    stderr: result.stderr,
    summary: `generated candidate with command proposer in ${Date.now() - startedAt}ms`,
    durationMs: Date.now() - startedAt,
  };
}

function resolveConfiguredCwd(workspacePath: string, configuredCwd?: string): string {
  return configuredCwd ? resolve(workspacePath, configuredCwd) : resolve(workspacePath);
}
