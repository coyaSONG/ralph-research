import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runResumeCommand } from "../src/cli/commands/resume.js";
import { researchSessionRecordSchema, type ResearchSessionRecord } from "../src/core/model/research-session.js";
import type { ResearchSessionRepository } from "../src/core/ports/research-session-repository.js";
import { createCapturingIo } from "./helpers/fixture-repo.js";

let tempRoot = "";
let canonicalTempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-resume-command-"));
  canonicalTempRoot = await realpath(tempRoot);
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("resume command", () => {
  it("continues the requested session through the interactive research service", async () => {
    const io = createCapturingIo();
    const repository = createRepository([makeSession()]);
    const interactiveSessionService = {
      continueSession: vi.fn(async () => ({
        sessionId: "session-001",
        lifecyclePath: ".ralph/sessions/session-001/codex-session.json",
        resumed: {
          step: "session_resumed" as const,
          session: {
            sessionId: "session-001",
          },
          cycle: {
            completedCycles: 2,
            nextCycle: 3,
            latestFrontierIds: [],
          },
        },
        finalized: {
          step: "session_interrupted" as const,
          session: {
            sessionId: "session-001",
          },
          cycle: {
            completedCycles: 2,
            nextCycle: 3,
            latestFrontierIds: [],
          },
        },
      })),
    };

    const exitCode = await runResumeCommand(
      "session-001",
      {
        repoRoot: tempRoot,
      },
      io,
      {
        interactiveSessionService,
        createRepository: () => repository,
      },
    );

    expect(exitCode).toBe(0);
    expect(interactiveSessionService.continueSession).toHaveBeenCalledTimes(1);
    expect(interactiveSessionService.continueSession).toHaveBeenCalledWith({
      repoRoot: canonicalTempRoot,
      sessionId: "session-001",
    });
    expect(io.stdoutText()).toContain("Session: session-001");
    expect(io.stdoutText()).toContain("Lifecycle evidence: .ralph/sessions/session-001/codex-session.json");
    expect(io.stdoutText()).toContain("Session ended before a completed cycle checkpoint and is awaiting resume.");
  });

  it("emits machine-readable output when requested", async () => {
    const io = createCapturingIo();
    const repository = createRepository([
      makeSession({
        sessionId: "session-002",
      }),
    ]);
    const interactiveSessionService = {
      continueSession: vi.fn(async () => ({
        sessionId: "session-002",
        lifecyclePath: ".ralph/sessions/session-002/codex-session.json",
        resumed: {
          step: "session_resumed" as const,
          session: {
            sessionId: "session-002",
          },
          cycle: {
            completedCycles: 4,
            nextCycle: 5,
            latestFrontierIds: [],
          },
        },
        finalized: {
          step: "session_failed" as const,
          session: {
            sessionId: "session-002",
          },
          cycle: {
            completedCycles: 4,
            nextCycle: 5,
            latestFrontierIds: [],
          },
        },
      })),
    };

    const exitCode = await runResumeCommand(
      "session-002",
      {
        repoRoot: tempRoot,
        json: true,
      },
      io,
      {
        interactiveSessionService,
        createRepository: () => repository,
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      sessionId: "session-002",
      lifecyclePath: ".ralph/sessions/session-002/codex-session.json",
      resumed: {
        step: "session_resumed",
      },
      finalized: {
        step: "session_failed",
      },
    });
  });

  it("resolves the latest resumable session identity before continuing", async () => {
    const io = createCapturingIo();
    const repository = createRepository([
      makeSession({
        sessionId: "session-001",
        updatedAt: "2026-04-12T00:01:00.000Z",
      }),
      makeSession({
        sessionId: "session-002",
        status: "halted",
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestFrontierIds: [],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastCheckpointAt: "2026-04-12T00:02:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 1,
            diffLineCount: 14,
            repeatedDiff: false,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            newArtifacts: ["reports/holdout-cycle-2.json"],
            reasons: ["Future holdout top-3 score improved."],
          },
        },
        stopCondition: {
          type: "operator_stop",
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: true,
          checkpointRunId: "run-002",
        },
        updatedAt: "2026-04-12T00:02:00.000Z",
      }),
    ]);
    const interactiveSessionService = {
      continueSession: vi.fn(async () => ({
        sessionId: "session-002",
        lifecyclePath: ".ralph/sessions/session-002/codex-session.json",
        resumed: {
          step: "session_resumed" as const,
          session: {
            sessionId: "session-002",
          },
          cycle: {
            completedCycles: 2,
            nextCycle: 3,
            latestFrontierIds: [],
          },
        },
        finalized: {
          step: "session_interrupted" as const,
          session: {
            sessionId: "session-002",
          },
          cycle: {
            completedCycles: 2,
            nextCycle: 3,
            latestFrontierIds: [],
          },
        },
      })),
    };

    const exitCode = await runResumeCommand(
      "latest",
      {
        repoRoot: tempRoot,
      },
      io,
      {
        interactiveSessionService,
        createRepository: () => repository,
      },
    );

    expect(exitCode).toBe(0);
    expect(interactiveSessionService.continueSession).toHaveBeenCalledWith({
      repoRoot: canonicalTempRoot,
      sessionId: "session-002",
    });
  });

  it("resolves a unique resumable session prefix before continuing", async () => {
    const io = createCapturingIo();
    const repository = createRepository([
      makeSession({
        sessionId: "session-20260412-000500",
      }),
      makeSession({
        sessionId: "session-20260412-001500",
        updatedAt: "2026-04-12T00:15:00.000Z",
      }),
    ]);
    const interactiveSessionService = {
      continueSession: vi.fn(async () => ({
        sessionId: "session-20260412-000500",
        lifecyclePath: ".ralph/sessions/session-20260412-000500/codex-session.json",
        resumed: {
          step: "session_resumed" as const,
          session: {
            sessionId: "session-20260412-000500",
          },
          cycle: {
            completedCycles: 1,
            nextCycle: 2,
            latestFrontierIds: [],
          },
        },
        finalized: {
          step: "session_interrupted" as const,
          session: {
            sessionId: "session-20260412-000500",
          },
          cycle: {
            completedCycles: 1,
            nextCycle: 2,
            latestFrontierIds: [],
          },
        },
      })),
    };

    const exitCode = await runResumeCommand(
      "  session-20260412-0005  ",
      {
        repoRoot: tempRoot,
      },
      io,
      {
        interactiveSessionService,
        createRepository: () => repository,
      },
    );

    expect(exitCode).toBe(0);
    expect(interactiveSessionService.continueSession).toHaveBeenCalledWith({
      repoRoot: canonicalTempRoot,
      sessionId: "session-20260412-000500",
    });
    expect(io.stdoutText()).toContain("Session: session-20260412-000500");
  });

  it("resolves the startup session selection from metadata-only storage lookups", async () => {
    const io = createCapturingIo();
    const interactiveSessionService = {
      continueSession: vi.fn(async () => ({
        sessionId: "session-metadata-001",
        lifecyclePath: ".ralph/sessions/session-metadata-001/codex-session.json",
        resumed: {
          step: "session_resumed" as const,
          session: {
            sessionId: "session-metadata-001",
          },
          cycle: {
            completedCycles: 3,
            nextCycle: 4,
            latestFrontierIds: [],
          },
        },
        finalized: {
          step: "session_interrupted" as const,
          session: {
            sessionId: "session-metadata-001",
          },
          cycle: {
            completedCycles: 3,
            nextCycle: 4,
            latestFrontierIds: [],
          },
        },
      })),
    };

    const exitCode = await runResumeCommand(
      "latest",
      {
        repoRoot: tempRoot,
      },
      io,
      {
        interactiveSessionService,
        createRepository: () => ({
          async loadSession() {
            throw new Error("loadSession should not be used when metadata lookups are available");
          },
          async loadSessionMetadata() {
            return null;
          },
          async querySessions() {
            throw new Error("querySessions should not be used when metadata lookups are available");
          },
          async querySessionMetadata() {
            return [
              {
                sessionId: "session-metadata-001",
                goal: "improve the holdout top-3 model",
                workingDirectory: canonicalTempRoot,
                status: "halted",
                createdAt: "2026-04-12T00:00:00.000Z",
                updatedAt: "2026-04-12T00:03:00.000Z",
                completedCycles: 3,
                lastCheckpointAt: "2026-04-12T00:02:30.000Z",
                resumeFromCycle: 4,
              },
            ];
          },
        }),
      },
    );

    expect(exitCode).toBe(0);
    expect(interactiveSessionService.continueSession).toHaveBeenCalledWith({
      repoRoot: canonicalTempRoot,
      sessionId: "session-metadata-001",
    });
  });

  it("rejects ambiguous resumable session prefixes using the standard CLI error shape", async () => {
    const io = createCapturingIo();
    const repository = createRepository([
      makeSession({
        sessionId: "session-20260412-000500",
      }),
      makeSession({
        sessionId: "session-20260412-001000",
        updatedAt: "2026-04-12T00:10:00.000Z",
      }),
    ]);
    const interactiveSessionService = {
      continueSession: vi.fn(),
    };

    const exitCode = await runResumeCommand(
      "session-20260412-00",
      {
        repoRoot: tempRoot,
        json: true,
      },
      io,
      {
        interactiveSessionService,
        createRepository: () => repository,
      },
    );

    expect(exitCode).toBe(1);
    expect(interactiveSessionService.continueSession).not.toHaveBeenCalled();
    expect(JSON.parse(io.stderrText())).toEqual({
      ok: false,
      error:
        'Session identity "session-20260412-00" is ambiguous: session-20260412-000500, session-20260412-001000',
    });
  });
});

function createRepository(
  sessions: readonly ResearchSessionRecord[],
): Pick<ResearchSessionRepository, "loadSession" | "querySessions"> {
  return {
    async loadSession(sessionId) {
      return sessions.find((session) => session.sessionId === sessionId) ?? null;
    },
    async querySessions(query = {}) {
      return sessions.filter((session) => {
        if (query.workingDirectory && session.workingDirectory !== query.workingDirectory) {
          return false;
        }

        if (query.statuses && !query.statuses.includes(session.status)) {
          return false;
        }

        return true;
      });
    },
  };
}

function makeSession(overrides: Partial<ResearchSessionRecord> = {}): ResearchSessionRecord {
  return researchSessionRecordSchema.parse({
    sessionId: "session-001",
    goal: "Reach 70% future holdout top-3 prediction success.",
    workingDirectory: canonicalTempRoot,
    status: "running",
    agent: {
      type: "codex_cli",
      command: "codex",
    },
    workspace: {
      strategy: "git_worktree",
      currentRef: "refs/heads/session-001",
      currentPath: join(tempRoot, ".ralph", "sessions", "session-001", "worktree"),
      promoted: false,
    },
    stopPolicy: {
      repeatedFailures: 3,
      noMeaningfulProgress: 5,
      insufficientEvidence: 3,
    },
    progress: {
      completedCycles: 0,
      nextCycle: 1,
      latestFrontierIds: [],
      repeatedFailureStreak: 0,
      noMeaningfulProgressStreak: 0,
      insufficientEvidenceStreak: 0,
    },
    stopCondition: {
      type: "none",
    },
    resume: {
      resumable: true,
      checkpointType: "completed_cycle_boundary",
      resumeFromCycle: 1,
      requiresUserConfirmation: false,
    },
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:00:00.000Z",
    ...overrides,
  });
}
