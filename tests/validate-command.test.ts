import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runValidateCommand } from "../src/cli/commands/validate.js";

const fixturesDir = new URL("./fixtures/manifests/", import.meta.url);
let tempRoot = "";
let originalCwd = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-validate-"));
  originalCwd = process.cwd();
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function createBufferedIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    io: {
      stdout: (message: string) => {
        stdout.push(message);
      },
      stderr: (message: string) => {
        stderr.push(message);
      },
    },
    stdout,
    stderr,
  };
}

describe("runValidateCommand", () => {
  it("prints success output for a valid manifest", async () => {
    const buffer = createBufferedIo();
    const exitCode = await runValidateCommand(
      {
        path: new URL("valid-writing.ralph.yaml", fixturesDir).pathname,
        json: false,
      },
      buffer.io,
    );

    expect(exitCode).toBe(0);
    expect(buffer.stdout[0]).toContain("Manifest is executable:");
    expect(buffer.stderr).toHaveLength(0);
  });

  it("prints json error output for an invalid manifest", async () => {
    const buffer = createBufferedIo();
    const exitCode = await runValidateCommand(
      {
        path: new URL("invalid-pareto.ralph.yaml", fixturesDir).pathname,
        json: true,
      },
      buffer.io,
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(buffer.stderr[0] ?? "{}")).toMatchObject({
      ok: false,
    });
  });

  it("reports unsupported workspace and operator manifests with stable admission payloads", async () => {
    const workspaceBuffer = createBufferedIo();
    const workspaceExitCode = await runValidateCommand(
      {
        path: new URL("invalid-unsupported-workspace.ralph.yaml", fixturesDir).pathname,
        json: true,
      },
      workspaceBuffer.io,
    );

    const operatorBuffer = createBufferedIo();
    const operatorExitCode = await runValidateCommand(
      {
        path: new URL("invalid-unsupported-operator-llm.ralph.yaml", fixturesDir).pathname,
        json: true,
      },
      operatorBuffer.io,
    );

    expect(workspaceExitCode).toBe(1);
    expect(JSON.parse(workspaceBuffer.stderr[0] ?? "{}")).toMatchObject({
      ok: false,
      executable: false,
      details: {
        issues: [
          expect.objectContaining({
            path: ["project", "workspace"],
          }),
        ],
      },
    });

    expect(operatorExitCode).toBe(1);
    expect(JSON.parse(operatorBuffer.stderr[0] ?? "{}")).toMatchObject({
      ok: false,
      executable: false,
      details: {
        issues: [
          expect.objectContaining({
            path: ["proposer", "type"],
          }),
        ],
      },
    });
  });

  it("reports unresolved baseline refs using the same repo-aware admission truth as run", async () => {
    const repoRoot = await initTempRepo();
    process.chdir(repoRoot);

    await writeFile(
      join(repoRoot, "ralph.yaml"),
      [
        'schemaVersion: "0.1"',
        "project:",
        "  name: validate-baseline",
        "  artifact: code",
        "  baselineRef: does-not-exist",
        "  workspace: git",
        "proposer:",
        "  type: command",
        "  command: ./scripts/propose.sh",
        "experiment:",
        "  run:",
        "    command: ./scripts/run.sh",
        "metrics:",
        "  catalog:",
        "    - id: quality",
        "      kind: numeric",
        "      direction: maximize",
        "      extractor:",
        "        type: command",
        "        command: ./scripts/metric.sh",
        "        parser: plain_number",
        "frontier:",
        "  strategy: single_best",
        "  primaryMetric: quality",
        "ratchet:",
        "  type: epsilon_improve",
        "  metric: quality",
        "  epsilon: 0",
      ].join("\n"),
      "utf8",
    );

    const buffer = createBufferedIo();
    const exitCode = await runValidateCommand(
      {
        path: "ralph.yaml",
        json: true,
      },
      buffer.io,
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(buffer.stderr[0] ?? "{}")).toMatchObject({
      ok: false,
      executable: false,
      details: {
        issues: [
          expect.objectContaining({
            path: ["project", "baselineRef"],
          }),
        ],
      },
    });
  });
});

async function initTempRepo(): Promise<string> {
  const repoRoot = join(tempRoot, "repo");
  await execa("git", ["init", repoRoot], { cwd: tempRoot });
  await execa("git", ["-C", repoRoot, "config", "user.name", "Ralph Research Tests"]);
  await execa("git", ["-C", repoRoot, "config", "user.email", "tests@example.com"]);
  await writeFile(join(repoRoot, "README.md"), "fixture\n", "utf8");
  await execa("git", ["-C", repoRoot, "add", "README.md"]);
  await execa("git", ["-C", repoRoot, "commit", "-m", "fixture"]);
  await execa("git", ["-C", repoRoot, "branch", "-M", "main"]);
  return repoRoot;
}
