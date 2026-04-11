import { access, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JsonFileRunStore } from "../src/adapters/fs/json-file-run-store.js";
import { runLaunchCommand } from "../src/cli/commands/launch.js";
import { researchSessionRecordSchema } from "../src/core/model/research-session.js";
import { createCapturingIo } from "./helpers/fixture-repo.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-launch-command-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("launch command", () => {
  it("hands the drafted session to the v1 TUI shell by default without starting a cycle", async () => {
    const io = createCapturingIo();
    const openShell = vi.fn(async () => undefined);

    const exitCode = await runLaunchCommand(
      "improve the holdout top-3 model",
      {
        repoRoot: tempRoot,
      },
      io,
      {
        openShell,
      },
    );

    expect(exitCode).toBe(0);
    expect(openShell).toHaveBeenCalledTimes(1);
    expect(openShell).toHaveBeenCalledWith(
      expect.objectContaining({
        interface: "tui",
        sessionId: "launch-draft",
        goal: "improve the holdout top-3 model",
      }),
      io,
    );

    const sessionPath = join(tempRoot, ".ralph", "sessions", "launch-draft", "session.json");
    const savedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(sessionPath, "utf8")),
    );
    expect(savedDraft.status).toBe("draft");
    expect(savedDraft.progress.completedCycles).toBe(0);
    expect(savedDraft.progress.nextCycle).toBe(1);

    const runStore = new JsonFileRunStore(join(tempRoot, ".ralph", "runs"));
    expect(await runStore.list()).toEqual([]);
  });

  it("keeps json launch output non-interactive", async () => {
    const io = createCapturingIo();
    const openShell = vi.fn(async () => undefined);

    const exitCode = await runLaunchCommand(
      "improve the holdout top-3 model",
      {
        repoRoot: tempRoot,
        json: true,
      },
      io,
      {
        openShell,
      },
    );

    expect(exitCode).toBe(0);
    expect(openShell).not.toHaveBeenCalled();

    const payload = JSON.parse(io.stdoutText());
    expect(payload).toMatchObject({
      interface: "tui",
      sessionId: "launch-draft",
      goal: "improve the holdout top-3 model",
    });

    await expect(access(join(tempRoot, ".ralph", "sessions", "launch-draft", "session.json"))).resolves.toBeUndefined();
  });

  it("routes a resume entry selection through the existing resume command handler", async () => {
    const io = createCapturingIo();
    const resumeCommand = vi.fn(async () => 0);
    const openShell = vi.fn(async () => ({
      entrySelection: "resume" as const,
      sessionId: "session-continue-001",
    }));

    const exitCode = await runLaunchCommand(
      "improve the holdout top-3 model",
      {
        repoRoot: tempRoot,
      },
      io,
      {
        openShell,
        resumeCommand,
      },
    );

    expect(exitCode).toBe(0);
    expect(openShell).toHaveBeenCalledTimes(1);
    expect(resumeCommand).toHaveBeenCalledTimes(1);
    expect(resumeCommand).toHaveBeenCalledWith(
      "session-continue-001",
      {
        repoRoot: await realpath(tempRoot),
      },
      io,
    );
  });
});
