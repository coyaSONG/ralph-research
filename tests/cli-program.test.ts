import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JsonFileRunStore } from "../src/adapters/fs/json-file-run-store.js";
import { researchSessionRecordSchema } from "../src/core/model/research-session.js";

const { openShellMock } = vi.hoisted(() => ({
  openShellMock: vi.fn(async () => undefined),
}));

vi.mock("../src/cli/tui/research-session-shell.js", () => ({
  openResearchSessionShell: openShellMock,
}));

import { createProgram, runCli } from "../src/cli/program.js";

let tempRoot = "";
let originalCwd = "";
let canonicalTempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-cli-program-"));
  canonicalTempRoot = await realpath(tempRoot);
  originalCwd = process.cwd();
  process.exitCode = undefined;
  openShellMock.mockClear();
});

afterEach(async () => {
  process.chdir(originalCwd);
  process.exitCode = undefined;
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("CLI program goal launch routing", () => {
  it("launches a new orchestrated research session from the root transport boundary and persists resumable draft state", async () => {
    process.chdir(tempRoot);

    await runCli(["node", "rrx", "improve the holdout top-3 model"]);

    expect(openShellMock).toHaveBeenCalledTimes(1);
    expect(openShellMock).toHaveBeenCalledWith(
      expect.objectContaining({
        interface: "tui",
        sessionId: "launch-draft",
        goal: "improve the holdout top-3 model",
        repoRoot: canonicalTempRoot,
        sessionPath: join(canonicalTempRoot, ".ralph", "sessions", "launch-draft", "session.json"),
      }),
      expect.anything(),
    );

    const sessionPath = join(canonicalTempRoot, ".ralph", "sessions", "launch-draft", "session.json");
    const savedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(sessionPath, "utf8")),
    );

    expect(savedDraft).toMatchObject({
      sessionId: "launch-draft",
      goal: "improve the holdout top-3 model",
      workingDirectory: canonicalTempRoot,
      status: "draft",
      progress: {
        completedCycles: 0,
        nextCycle: 1,
        latestFrontierIds: [],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 1,
        requiresUserConfirmation: false,
      },
    });

    const runStore = new JsonFileRunStore(join(canonicalTempRoot, ".ralph", "runs"));
    expect(await runStore.list()).toEqual([]);
  });

  it("routes the explicit launch subcommand to the v1 launch flow", async () => {
    process.chdir(tempRoot);
    const launchCommand = vi.fn(async () => 0);
    const resumeCommand = vi.fn(async () => 0);
    const runCommand = vi.fn(async () => 0);
    const program = createProgram({
      launchCommand,
      resumeCommand,
      runCommand,
    });

    await program.parseAsync(["node", "rrx", "launch", "improve the holdout top-3 model", "--json"]);

    expect(launchCommand).toHaveBeenCalledTimes(1);
    expect(launchCommand).toHaveBeenCalledWith("improve the holdout top-3 model", {
      json: true,
      repoRoot: await realpath(tempRoot),
    });
    expect(resumeCommand).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("passes the root goal argument and current working directory into the v1 launch flow", async () => {
    process.chdir(tempRoot);
    const launchCommand = vi.fn(async () => 0);
    const resumeCommand = vi.fn(async () => 0);
    const runCommand = vi.fn(async () => 0);
    const program = createProgram({
      launchCommand,
      resumeCommand,
      runCommand,
    });

    await program.parseAsync(["node", "rrx", "improve the holdout top-3 model"]);

    expect(launchCommand).toHaveBeenCalledTimes(1);
    expect(launchCommand).toHaveBeenCalledWith("improve the holdout top-3 model", {
      repoRoot: await realpath(tempRoot),
    });
    expect(resumeCommand).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("keeps the run subcommand routed to the legacy run command handler", async () => {
    process.chdir(tempRoot);
    const launchCommand = vi.fn(async () => 0);
    const resumeCommand = vi.fn(async () => 0);
    const runCommand = vi.fn(async () => 0);
    const program = createProgram({
      launchCommand,
      resumeCommand,
      runCommand,
    });

    await program.parseAsync(["node", "rrx", "run", "--json"]);

    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        json: true,
      }),
    );
    expect(launchCommand).not.toHaveBeenCalled();
    expect(resumeCommand).not.toHaveBeenCalled();
  });

  it("rejects invalid run count options before invoking the run handler", async () => {
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      for (const args of [
        ["run", "--cycles", "0"],
        ["run", "--cycles", "1.5"],
        ["run", "--cycles", "abc"],
        ["run", "--cycles", "1abc"],
        ["run", "--until-no-improve", "0"],
        ["run", "--until-no-improve", "1abc"],
      ]) {
        const launchCommand = vi.fn(async () => 0);
        const resumeCommand = vi.fn(async () => 0);
        const runCommand = vi.fn(async () => 0);
        const program = createProgram({
          launchCommand,
          resumeCommand,
          runCommand,
        });
        program.exitOverride();
        program.configureOutput({
          writeErr: () => undefined,
          writeOut: () => undefined,
          outputError: () => undefined,
        });

        await expect(program.parseAsync(["node", "rrx", ...args])).rejects.toThrow();
        expect(runCommand).not.toHaveBeenCalled();
      }
    } finally {
      stderrWrite.mockRestore();
    }
  });

  it("registers the resume subcommand and passes the session id through unchanged", async () => {
    process.chdir(tempRoot);
    const launchCommand = vi.fn(async () => 0);
    const resumeCommand = vi.fn(async () => 0);
    const runCommand = vi.fn(async () => 0);
    const program = createProgram({
      launchCommand,
      resumeCommand,
      runCommand,
    });

    expect(program.commands.map((command) => command.name())).toContain("resume");

    await program.parseAsync(["node", "rrx", "resume", "session-001", "--json"]);

    expect(resumeCommand).toHaveBeenCalledTimes(1);
    expect(resumeCommand).toHaveBeenCalledWith("session-001", {
      json: true,
      repoRoot: await realpath(tempRoot),
    });
    expect(launchCommand).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("forwards special resume identities like latest to the resume command unchanged", async () => {
    process.chdir(tempRoot);
    const launchCommand = vi.fn(async () => 0);
    const resumeCommand = vi.fn(async () => 0);
    const runCommand = vi.fn(async () => 0);
    const program = createProgram({
      launchCommand,
      resumeCommand,
      runCommand,
    });

    await program.parseAsync(["node", "rrx", "resume", "latest"]);

    expect(resumeCommand).toHaveBeenCalledTimes(1);
    expect(resumeCommand).toHaveBeenCalledWith("latest", {
      json: false,
      repoRoot: await realpath(tempRoot),
    });
    expect(launchCommand).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  });
});
