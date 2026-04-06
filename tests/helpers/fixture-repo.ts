import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { execa } from "execa";

export async function initNumericFixtureRepo(repoRoot: string): Promise<void> {
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, "scripts"), { recursive: true });
  await mkdir(join(repoRoot, "prompts"), { recursive: true });

  await execa("git", ["init"], { cwd: repoRoot });
  await execa("git", ["config", "user.name", "Ralph Research Tests"], { cwd: repoRoot });
  await execa("git", ["config", "user.email", "tests@example.com"], { cwd: repoRoot });

  await writeFile(join(repoRoot, "docs", "draft.md"), "Baseline draft.\n", "utf8");
  await writeFile(
    join(repoRoot, "scripts", "propose.mjs"),
    [
      'import { writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'writeFileSync(join(process.cwd(), "docs", "draft.md"), "Improved draft with stronger structure.\\n", "utf8");',
      'console.log("proposal complete");',
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(repoRoot, "scripts", "experiment.mjs"),
    [
      'import { cpSync, mkdirSync } from "node:fs";',
      'import { join } from "node:path";',
      'mkdirSync(join(process.cwd(), "out"), { recursive: true });',
      'cpSync(join(process.cwd(), "docs", "draft.md"), join(process.cwd(), "out", "draft.md"));',
      'console.log("experiment complete");',
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(repoRoot, "scripts", "metric.mjs"), 'console.log("0.7");\n', "utf8");
  await writeFile(join(repoRoot, "prompts", "judge.md"), "Return JSON only.\n", "utf8");
  await writeFile(join(repoRoot, "ralph.yaml"), buildNumericManifest(), "utf8");

  await execa("git", ["add", "."], { cwd: repoRoot });
  await execa("git", ["commit", "-m", "fixture"], { cwd: repoRoot });
  await execa("git", ["branch", "-M", "main"], { cwd: repoRoot });
}

export async function initIncrementingMetricFixtureRepo(repoRoot: string): Promise<void> {
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, "scripts"), { recursive: true });

  await execa("git", ["init"], { cwd: repoRoot });
  await execa("git", ["config", "user.name", "Ralph Research Tests"], { cwd: repoRoot });
  await execa("git", ["config", "user.email", "tests@example.com"], { cwd: repoRoot });

  await writeFile(join(repoRoot, "docs", "draft.md"), "Baseline draft.\n", "utf8");
  await writeFile(
    join(repoRoot, "scripts", "propose.mjs"),
    [
      'import { appendFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'appendFileSync(join(process.cwd(), "docs", "draft.md"), "Improved draft line.\\n", "utf8");',
      'console.log("proposal complete");',
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(repoRoot, "scripts", "experiment.mjs"),
    [
      'import { cpSync, mkdirSync } from "node:fs";',
      'import { join } from "node:path";',
      'mkdirSync(join(process.cwd(), "out"), { recursive: true });',
      'cpSync(join(process.cwd(), "docs", "draft.md"), join(process.cwd(), "out", "draft.md"));',
      'console.log("experiment complete");',
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(repoRoot, "scripts", "metric.mjs"),
    [
      'import { readFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'const draft = readFileSync(join(process.cwd(), "docs", "draft.md"), "utf8");',
      'const matches = draft.match(/Improved draft line\\./g) ?? [];',
      'console.log(String(0.6 + matches.length * 0.1));',
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(repoRoot, "ralph.yaml"), buildIncrementingManifest(), "utf8");

  await execa("git", ["add", "."], { cwd: repoRoot });
  await execa("git", ["commit", "-m", "fixture"], { cwd: repoRoot });
  await execa("git", ["branch", "-M", "main"], { cwd: repoRoot });
}

export function createCapturingIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout: (message: string) => {
      stdout.push(message);
    },
    stderr: (message: string) => {
      stderr.push(message);
    },
    stdoutText: () => stdout.join("\n"),
    stderrText: () => stderr.join("\n"),
  };
}

function buildNumericManifest(): string {
  return [
    'schemaVersion: "0.1"',
    "project:",
    "  name: test-numeric",
    "  artifact: manuscript",
    "  baselineRef: main",
    "  workspace: git",
    "scope:",
    "  allowedGlobs:",
    '    - "**/*.md"',
    "  maxFilesChanged: 2",
    "  maxLineDelta: 20",
    "proposer:",
    "  type: command",
    '  command: "node scripts/propose.mjs"',
    "experiment:",
    "  run:",
    '    command: "node scripts/experiment.mjs"',
    "  outputs:",
    "    - id: draft",
    "      path: out/draft.md",
    "metrics:",
    "  catalog:",
    "    - id: quality",
    "      kind: numeric",
    "      direction: maximize",
    "      extractor:",
    "        type: command",
    '        command: "node scripts/metric.mjs"',
    "        parser: plain_number",
    "constraints: []",
    "frontier:",
    "  strategy: single_best",
    "  primaryMetric: quality",
    "ratchet:",
    "  type: epsilon_improve",
    "  metric: quality",
    "  epsilon: 0",
    "storage:",
    "  root: .ralph",
    "",
  ].join("\n");
}

function buildIncrementingManifest(): string {
  return [
    'schemaVersion: "0.1"',
    "project:",
    "  name: test-incrementing",
    "  artifact: manuscript",
    "  baselineRef: main",
    "  workspace: git",
    "scope:",
    "  allowedGlobs:",
    '    - "**/*.md"',
    "  maxFilesChanged: 2",
    "  maxLineDelta: 20",
    "proposer:",
    "  type: command",
    '  command: "node scripts/propose.mjs"',
    "experiment:",
    "  run:",
    '    command: "node scripts/experiment.mjs"',
    "  outputs:",
    "    - id: draft",
    "      path: out/draft.md",
    "metrics:",
    "  catalog:",
    "    - id: quality",
    "      kind: numeric",
    "      direction: maximize",
    "      extractor:",
    "        type: command",
    '        command: "node scripts/metric.mjs"',
    "        parser: plain_number",
    "constraints: []",
    "frontier:",
    "  strategy: single_best",
    "  primaryMetric: quality",
    "ratchet:",
    "  type: epsilon_improve",
    "  metric: quality",
    "  epsilon: 0",
    "stopping:",
    "  target:",
    "    metric: quality",
    "    op: \">=\"",
    "    value: 0.8",
    "storage:",
    "  root: .ralph",
    "",
  ].join("\n");
}
