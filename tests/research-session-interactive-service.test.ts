import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JsonFileResearchSessionRepository } from "../src/adapters/fs/json-file-research-session-repository.js";
import { CodexCliSessionLifecycleService } from "../src/app/services/codex-cli-session-lifecycle-service.js";
import { ResearchSessionLaunchService } from "../src/app/services/research-session-launch-service.js";
import { ResearchSessionInteractiveService } from "../src/app/services/research-session-interactive-service.js";
import { ResearchSessionOrchestratorService } from "../src/app/services/research-session-orchestrator-service.js";
import { ResearchSessionRecoveryService } from "../src/app/services/research-session-recovery-service.js";
import {
  parseCodexCliSessionLifecycleRecord,
  serializeCodexCliSessionLifecycleRecord,
  type CodexCliSessionLifecycleRecord,
} from "../src/core/model/codex-cli-session-lifecycle.js";
import {
  researchSessionRecordSchema,
  type ResearchSessionRecord,
} from "../src/core/model/research-session.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-session-interactive-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("ResearchSessionInteractiveService", () => {
  it("persists a clean interactive exit as awaiting_resume with lifecycle evidence", async () => {
    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await launchService.launch({
      goal: "improve future holdout top-3 accuracy",
      repoRoot: tempRoot,
    });
    const service = new ResearchSessionInteractiveService({
      now: vi.fn()
        .mockReturnValueOnce(new Date("2026-04-12T00:05:00.000Z"))
        .mockReturnValueOnce(new Date("2026-04-12T00:05:01.000Z"))
        .mockReturnValueOnce(new Date("2026-04-12T00:05:02.000Z"))
        .mockReturnValueOnce(new Date("2026-04-12T00:05:03.000Z"))
        .mockReturnValueOnce(new Date("2026-04-12T00:05:04.000Z"))
        .mockReturnValueOnce(new Date("2026-04-12T00:05:05.000Z"))
        .mockReturnValueOnce(new Date("2026-04-12T00:05:06.000Z")),
      createOrchestrator: () =>
        new ResearchSessionOrchestratorService({
          now: () => new Date("2026-04-12T00:05:10.000Z"),
          createSessionId: () => "session-20260412-000500",
        }),
      createSessionManager: () =>
        ({
          startSession: (options) => ({
            pid: 42,
            command: options.command ?? "codex",
            args: ["-C", options.cwd, "-a", options.approvalPolicy, "-s", options.sandboxMode],
            waitForExit: async () => ({
              code: 0,
              signal: null,
            }),
            stop: async () => ({
              code: null,
              signal: "SIGTERM" as const,
            }),
          }),
        }) as never,
    });

    const result = await service.launchFromDraft({
      repoRoot: tempRoot,
      draftSessionId: launch.sessionId,
    });

    expect(result).toMatchObject({
      sessionId: "session-20260412-000500",
      lifecyclePath: ".ralph/sessions/session-20260412-000500/codex-session.json",
      started: {
        step: "session_started",
      },
      finalized: {
        step: "session_interrupted",
        session: {
          status: "awaiting_resume",
          resume: {
            resumeFromCycle: 1,
            requiresUserConfirmation: true,
            interruptedDuringCycle: 1,
          },
        },
      },
    });
    expect(result.finalized.session.resume.note).toContain("exited cleanly before cycle 1 completed");
    expect(result.finalized.session.resume.note).toContain(result.lifecyclePath);

    const persistedSession = researchSessionRecordSchema.parse(
      JSON.parse(
        await readFile(
          join(tempRoot, ".ralph", "sessions", "session-20260412-000500", "session.json"),
          "utf8",
        ),
      ),
    );
    expect(persistedSession.status).toBe("awaiting_resume");

    const lifecycle = JSON.parse(
      await readFile(
        join(tempRoot, ".ralph", "sessions", "session-20260412-000500", "codex-session.json"),
        "utf8",
      ),
    );
    expect(lifecycle).toMatchObject({
      sessionId: "session-20260412-000500",
      goal: "improve future holdout top-3 accuracy",
      phase: "clean_exit",
      pid: 42,
      exit: {
        code: 0,
        signal: null,
      },
      resumeFromCycle: 1,
      completedCycles: 0,
      command: "codex",
      attachmentState: {
        status: "released",
      },
    });
  });

  it("records signaled exits as resumable interruptions instead of terminal failures", async () => {
    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await launchService.launch({
      goal: "improve future holdout top-3 accuracy",
      repoRoot: tempRoot,
    });
    const service = new ResearchSessionInteractiveService({
      now: () => new Date("2026-04-12T00:06:00.000Z"),
      createOrchestrator: () =>
        new ResearchSessionOrchestratorService({
          now: () => new Date("2026-04-12T00:06:10.000Z"),
          createSessionId: () => "session-20260412-000600",
        }),
      createSessionManager: () =>
        ({
          startSession: () => ({
            pid: 84,
            command: "codex",
            args: [],
            waitForExit: async () => ({
              code: null,
              signal: "SIGINT" as const,
            }),
            stop: async () => ({
              code: null,
              signal: "SIGTERM" as const,
            }),
          }),
        }) as never,
    });

    const result = await service.launchFromDraft({
      repoRoot: tempRoot,
      draftSessionId: launch.sessionId,
    });

    expect(result.finalized.step).toBe("session_interrupted");
    expect(result.finalized.session.status).toBe("awaiting_resume");
    expect(result.finalized.session.resume.note).toContain("signal SIGINT");

    const lifecycle = JSON.parse(
      await readFile(
        join(tempRoot, ".ralph", "sessions", "session-20260412-000600", "codex-session.json"),
        "utf8",
      ),
    );
    expect(lifecycle.phase).toBe("signaled");
    expect(lifecycle.exit).toEqual({
      code: null,
      signal: "SIGINT",
    });
    expect(lifecycle.attachmentState.status).toBe("released");
  });

  it("marks startup failures as failed sessions and persists the startup error evidence", async () => {
    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await launchService.launch({
      goal: "improve future holdout top-3 accuracy",
      repoRoot: tempRoot,
    });
    const service = new ResearchSessionInteractiveService({
      now: () => new Date("2026-04-12T00:07:00.000Z"),
      createOrchestrator: () =>
        new ResearchSessionOrchestratorService({
          now: () => new Date("2026-04-12T00:07:10.000Z"),
          createSessionId: () => "session-20260412-000700",
        }),
      createSessionManager: () =>
        ({
          startSession: () => {
            throw new Error("spawn codex ENOENT");
          },
        }) as never,
    });

    const result = await service.launchFromDraft({
      repoRoot: tempRoot,
      draftSessionId: launch.sessionId,
    });

    expect(result.finalized.step).toBe("session_failed");
    expect(result.finalized.session.status).toBe("failed");
    expect(result.finalized.session.stopCondition).toMatchObject({
      type: "unrecoverable_error",
    });
    expect(result.finalized.session.stopCondition.type).toBe("unrecoverable_error");
    if (result.finalized.session.stopCondition.type === "unrecoverable_error") {
      expect(result.finalized.session.stopCondition.message).toContain("failed to start");
      expect(result.finalized.session.stopCondition.message).toContain(result.lifecyclePath);
    }

    const lifecycle = JSON.parse(
      await readFile(
        join(tempRoot, ".ralph", "sessions", "session-20260412-000700", "codex-session.json"),
        "utf8",
      ),
    );
    expect(lifecycle.phase).toBe("startup_error");
    expect(lifecycle.error.message).toBe("spawn codex ENOENT");
    expect(lifecycle.attachmentState.status).toBe("released");
  });

  it("marks waitForExit adapter errors as failed sessions with runtime evidence", async () => {
    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await launchService.launch({
      goal: "improve future holdout top-3 accuracy",
      repoRoot: tempRoot,
    });
    const service = new ResearchSessionInteractiveService({
      now: () => new Date("2026-04-12T00:08:00.000Z"),
      createOrchestrator: () =>
        new ResearchSessionOrchestratorService({
          now: () => new Date("2026-04-12T00:08:10.000Z"),
          createSessionId: () => "session-20260412-000800",
        }),
      createSessionManager: () =>
        ({
          startSession: () => ({
            pid: 168,
            command: "codex",
            args: [],
            waitForExit: async () => {
              throw new Error("tty transport closed unexpectedly");
            },
            stop: async () => ({
              code: null,
              signal: "SIGTERM" as const,
            }),
          }),
        }) as never,
    });

    const result = await service.launchFromDraft({
      repoRoot: tempRoot,
      draftSessionId: launch.sessionId,
    });

    expect(result.finalized.step).toBe("session_failed");
    if (result.finalized.session.stopCondition.type === "unrecoverable_error") {
      expect(result.finalized.session.stopCondition.message).toContain("failed while waiting for exit");
      expect(result.finalized.session.stopCondition.message).toContain(result.lifecyclePath);
    }

    const lifecycle = JSON.parse(
      await readFile(
        join(tempRoot, ".ralph", "sessions", "session-20260412-000800", "codex-session.json"),
        "utf8",
      ),
    );
    expect(lifecycle.phase).toBe("runtime_error");
    expect(lifecycle.error.message).toBe("tty transport closed unexpectedly");
    expect(lifecycle.attachmentState.status).toBe("released");
  });

  it("continues a resumable halted session through the same lifecycle persistence path", async () => {
    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await launchService.launch({
      goal: "improve future holdout top-3 accuracy",
      repoRoot: tempRoot,
    });
    const starter = new ResearchSessionInteractiveService({
      now: () => new Date("2026-04-12T00:01:00.000Z"),
      createOrchestrator: () =>
        new ResearchSessionOrchestratorService({
          now: () => new Date("2026-04-12T00:01:10.000Z"),
          createSessionId: () => "session-continue-001",
        }),
      createSessionManager: () =>
        ({
          startSession: () => ({
            pid: 42,
            command: "codex",
            args: [],
            waitForExit: async () => ({
              code: 0,
              signal: null,
            }),
            stop: async () => ({
              code: null,
              signal: "SIGTERM" as const,
            }),
          }),
        }) as never,
    });

    await starter.launchFromDraft({
      repoRoot: tempRoot,
      draftSessionId: launch.sessionId,
    });

    const continuer = new ResearchSessionInteractiveService({
      now: () => new Date("2026-04-12T00:02:00.000Z"),
      createOrchestrator: () =>
        new ResearchSessionOrchestratorService({
          now: () => new Date("2026-04-12T00:02:10.000Z"),
        }),
      createSessionManager: () =>
        ({
          startSession: () => ({
            pid: 84,
            command: "codex",
            args: ["continue"],
            waitForExit: async () => ({
              code: 0,
              signal: null,
            }),
            stop: async () => ({
              code: null,
              signal: "SIGTERM" as const,
            }),
          }),
        }) as never,
    });

    const result = await continuer.continueSession({
      repoRoot: tempRoot,
      sessionId: "session-continue-001",
    });

    expect(result.resumed.step).toBe("session_resumed");
    expect(result.finalized.step).toBe("session_interrupted");
    expect(result.finalized.session.status).toBe("awaiting_resume");

    const lifecycle = JSON.parse(
      await readFile(
        join(tempRoot, ".ralph", "sessions", "session-continue-001", "codex-session.json"),
        "utf8",
      ),
    );
    expect(lifecycle).toMatchObject({
      sessionId: "session-continue-001",
      phase: "clean_exit",
      pid: 84,
      attachmentState: {
        status: "released",
      },
    });
  });

  it("reattaches to a reusable live Codex session instead of spawning a replacement session", async () => {
    const startSession = vi.fn(() => {
      throw new Error("startSession should not be called when reusing a live session");
    });
    const reattachSession = vi.fn(() => ({
      pid: 99,
      command: "codex",
      args: ["continue"],
      waitForExit: async () => ({
        code: 0,
        signal: null,
      }),
      stop: async () => ({
        code: null,
        signal: "SIGTERM" as const,
      }),
    }));
    const recordCodexSessionLifecycle = vi.fn(async () => ({
      sessionId: "session-live-001",
      phase: "running",
    })) as never;
    const recordInterruption = vi.fn(async () => ({
      step: "session_interrupted",
      session: {
        sessionId: "session-live-001",
        status: "awaiting_resume",
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestFrontierIds: [],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: true,
        },
      },
      cycle: {
        completedCycles: 2,
        nextCycle: 3,
        latestFrontierIds: [],
      },
    })) as never;
    const service = new ResearchSessionInteractiveService({
      createOrchestrator: () =>
        ({
          continueSession: async () => ({
            step: "session_resumed",
            session: {
              sessionId: "session-live-001",
              goal: "improve future holdout top-3 accuracy",
              workingDirectory: tempRoot,
              status: "running",
              agent: {
                type: "codex_cli",
                command: "codex",
                approvalPolicy: "never",
                sandboxMode: "workspace-write",
                ttySession: {
                  startupTimeoutSec: 30,
                  turnTimeoutSec: 900,
                },
              },
              context: {
                trackableGlobs: ["**/*.ts"],
                webSearch: true,
                shellCommandAllowlistAdditions: [],
                shellCommandAllowlistRemovals: [],
              },
              workspace: {
                strategy: "git_worktree",
                promoted: false,
              },
              stopPolicy: {
                repeatedFailures: 3,
                noMeaningfulProgress: 5,
                insufficientEvidence: 3,
              },
              progress: {
                completedCycles: 2,
                nextCycle: 3,
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
                resumeFromCycle: 3,
                requiresUserConfirmation: false,
              },
              createdAt: "2026-04-12T00:00:00.000Z",
              updatedAt: "2026-04-12T00:12:00.000Z",
            },
            cycle: {
              completedCycles: 2,
              nextCycle: 3,
              latestFrontierIds: [],
              sessionResolution: {
                decision: "reuse",
                session: {
                  sessionId: "session-live-001",
                },
                lifecycle: {
                  sessionId: "session-live-001",
                  workingDirectory: tempRoot,
                  goal: "improve future holdout top-3 accuracy",
                  resumeFromCycle: 3,
                  completedCycles: 2,
                  command: "codex",
                  args: ["continue"],
                  approvalPolicy: "never",
                  sandboxMode: "workspace-write",
                  startedAt: "2026-04-12T00:00:00.000Z",
                  updatedAt: "2026-04-12T00:12:00.000Z",
                  phase: "running",
                  pid: 99,
                  identity: {
                    researchSessionId: "session-live-001",
                    codexSessionId: "session-live-001",
                    agent: "codex_cli",
                  },
                  tty: {
                    stdinIsTty: true,
                    stdoutIsTty: true,
                    startupTimeoutSec: 30,
                    turnTimeoutSec: 900,
                  },
                  attachmentState: {
                    mode: "working_directory",
                    status: "bound",
                    workingDirectory: tempRoot,
                    trackedGlobs: ["**/*.ts"],
                    attachedPaths: [],
                    extraWritableDirectories: [tempRoot],
                  },
                  references: {
                    checkpointRunId: "run-002",
                    checkpointDecisionId: "decision-002",
                  },
                },
                recovery: {
                  classification: "inspect_only",
                  resumeAllowed: false,
                  reason: "Codex CLI session is still live and bound to the persisted working-directory attachment",
                  runtime: {
                    state: "active",
                    processAlive: true,
                    stale: false,
                    pid: 99,
                    phase: "running",
                  },
                },
                codexSessionReference: {
                  codexSessionId: "session-live-001",
                  lifecyclePath: join(tempRoot, ".ralph", "sessions", "session-live-001", "codex-session.json"),
                },
                reason: "Codex CLI session is still live and bound to the persisted working-directory attachment",
                reuse: {
                  researchSessionId: "session-live-001",
                  codexSessionId: "session-live-001",
                  pid: 99,
                  phase: "running",
                  command: "codex",
                  args: ["continue"],
                  workingDirectory: tempRoot,
                  attachmentStatus: "bound",
                  trackedGlobs: ["**/*.ts"],
                  extraWritableDirectories: [tempRoot],
                  tty: {
                    stdinIsTty: true,
                    stdoutIsTty: true,
                    startupTimeoutSec: 30,
                    turnTimeoutSec: 900,
                  },
                  checkpointRunId: "run-002",
                  checkpointDecisionId: "decision-002",
                },
              },
            },
          }),
          recordCodexSessionLifecycle,
          recordInterruption,
          failSession: vi.fn(),
        }) as never,
      createSessionManager: () =>
        ({
          startSession,
          reattachSession,
        }) as never,
    });

    const result = await service.continueSession({
      repoRoot: tempRoot,
      sessionId: "session-live-001",
    });

    expect(startSession).not.toHaveBeenCalled();
    expect(reattachSession).toHaveBeenCalledWith({
      sessionId: "session-live-001",
      codexSessionId: "session-live-001",
    });
    expect(result.resumed.step).toBe("session_resumed");
    expect(result.finalized.step).toBe("session_interrupted");
  });

  it("falls back to a fresh Codex session when a reusable attachment cannot be reattached from a new process", async () => {
    const canonicalRepoRoot = await realpath(tempRoot);
    const startSession = vi.fn(() => ({
      pid: 144,
      command: "codex",
      args: ["continue"],
      metadata: {
        launchMode: "new",
        researchSessionId: "session-live-001",
      },
      waitForExit: async () => ({
        code: 0,
        signal: null,
      }),
      stop: async () => ({
        code: null,
        signal: "SIGTERM" as const,
      }),
    }));
    const reattachSession = vi.fn(() => {
      throw new Error("Active Codex CLI session not found for session-live-001");
    });
    const recordCodexSessionLifecycle = vi.fn(async () => ({
      sessionId: "session-live-001",
      phase: "running",
    })) as never;
    const recordInterruption = vi.fn(async () => ({
      step: "session_interrupted",
      session: {
        sessionId: "session-live-001",
        status: "awaiting_resume",
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestFrontierIds: [],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: true,
        },
      },
      cycle: {
        completedCycles: 2,
        nextCycle: 3,
        latestFrontierIds: [],
      },
    })) as never;
    const service = new ResearchSessionInteractiveService({
      createOrchestrator: () =>
        ({
          continueSession: async () => ({
            step: "session_resumed",
            session: {
              sessionId: "session-live-001",
              goal: "improve future holdout top-3 accuracy",
              workingDirectory: tempRoot,
              status: "running",
              agent: {
                type: "codex_cli",
                command: "codex",
                approvalPolicy: "never",
                sandboxMode: "workspace-write",
                ttySession: {
                  startupTimeoutSec: 30,
                  turnTimeoutSec: 900,
                },
              },
              context: {
                trackableGlobs: ["**/*.ts"],
                webSearch: true,
                shellCommandAllowlistAdditions: [],
                shellCommandAllowlistRemovals: [],
              },
              workspace: {
                strategy: "git_worktree",
                promoted: false,
              },
              stopPolicy: {
                repeatedFailures: 3,
                noMeaningfulProgress: 5,
                insufficientEvidence: 3,
              },
              progress: {
                completedCycles: 2,
                nextCycle: 3,
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
                resumeFromCycle: 3,
                requiresUserConfirmation: false,
              },
              createdAt: "2026-04-12T00:00:00.000Z",
              updatedAt: "2026-04-12T00:12:00.000Z",
            },
            cycle: {
              completedCycles: 2,
              nextCycle: 3,
              latestFrontierIds: [],
              sessionResolution: {
                decision: "reuse",
                session: {
                  sessionId: "session-live-001",
                },
                lifecycle: {
                  sessionId: "session-live-001",
                  workingDirectory: tempRoot,
                  goal: "improve future holdout top-3 accuracy",
                  resumeFromCycle: 3,
                  completedCycles: 2,
                  command: "codex",
                  args: ["continue"],
                  approvalPolicy: "never",
                  sandboxMode: "workspace-write",
                  startedAt: "2026-04-12T00:00:00.000Z",
                  updatedAt: "2026-04-12T00:12:00.000Z",
                  phase: "running",
                  pid: 3131,
                  identity: {
                    researchSessionId: "session-live-001",
                    codexSessionId: "session-live-001",
                    agent: "codex_cli",
                  },
                  tty: {
                    stdinIsTty: true,
                    stdoutIsTty: true,
                    startupTimeoutSec: 30,
                    turnTimeoutSec: 900,
                  },
                  attachmentState: {
                    mode: "working_directory",
                    status: "bound",
                    workingDirectory: tempRoot,
                    trackedGlobs: ["**/*.ts"],
                    attachedPaths: [],
                    extraWritableDirectories: [tempRoot],
                  },
                  references: {
                    checkpointRunId: "run-002",
                    checkpointDecisionId: "decision-002",
                  },
                },
                recovery: {
                  classification: "inspect_only",
                  resumeAllowed: false,
                  reason: "Codex CLI session is still live and bound to the persisted working-directory attachment",
                  runtime: {
                    state: "active",
                    processAlive: true,
                    stale: false,
                    pid: 3131,
                    phase: "running",
                  },
                },
                codexSessionReference: {
                  codexSessionId: "session-live-001",
                  lifecyclePath: join(tempRoot, ".ralph", "sessions", "session-live-001", "codex-session.json"),
                },
                reason: "Codex CLI session is still live and bound to the persisted working-directory attachment",
                reuse: {
                  researchSessionId: "session-live-001",
                  codexSessionId: "session-live-001",
                  pid: 3131,
                  phase: "running",
                  command: "codex",
                  args: ["continue"],
                  workingDirectory: tempRoot,
                  attachmentStatus: "bound",
                  trackedGlobs: ["**/*.ts"],
                  extraWritableDirectories: [tempRoot],
                  tty: {
                    stdinIsTty: true,
                    stdoutIsTty: true,
                    startupTimeoutSec: 30,
                    turnTimeoutSec: 900,
                  },
                  checkpointRunId: "run-002",
                  checkpointDecisionId: "decision-002",
                },
              },
            },
          }),
          recordCodexSessionLifecycle,
          recordInterruption,
          failSession: vi.fn(),
        }) as never,
      createSessionManager: () =>
        ({
          startSession,
          reattachSession,
        }) as never,
    });

    const result = await service.continueSession({
      repoRoot: tempRoot,
      sessionId: "session-live-001",
    });

    expect(reattachSession).toHaveBeenCalledWith({
      sessionId: "session-live-001",
      codexSessionId: "session-live-001",
    });
    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: tempRoot,
        sessionId: "session-live-001",
        command: "codex",
        approvalPolicy: "never",
        sandboxMode: "workspace-write",
        prompt: "improve future holdout top-3 accuracy",
        extraWritableDirectories: [canonicalRepoRoot],
      }),
    );
    expect(startSession.mock.calls[0]?.[0]).not.toHaveProperty("existingSessionId");
    expect(result.resumed.step).toBe("session_resumed");
    expect(result.finalized.step).toBe("session_interrupted");
  });

  it("persists replacement detach and attach lifecycle transitions before waiting on the new Codex tty session", async () => {
    const startSession = vi.fn(() => ({
      pid: 123,
      command: "codex",
      args: ["continue"],
      waitForExit: async () => ({
        code: 0,
        signal: null,
      }),
      stop: async () => ({
        code: null,
        signal: "SIGTERM" as const,
      }),
    }));
    const recordCodexSessionLifecycle = vi.fn(async () => ({
      sessionId: "session-replace-001",
      phase: "running",
    })) as never;
    const service = new ResearchSessionInteractiveService({
      createOrchestrator: () =>
        ({
          continueSession: async () => ({
            step: "session_resumed",
            session: {
              sessionId: "session-replace-001",
              goal: "improve future holdout top-3 accuracy",
              workingDirectory: tempRoot,
              status: "running",
              agent: {
                type: "codex_cli",
                command: "codex",
                approvalPolicy: "never",
                sandboxMode: "workspace-write",
                ttySession: {
                  startupTimeoutSec: 30,
                  turnTimeoutSec: 900,
                },
              },
              context: {
                trackableGlobs: ["**/*.ts"],
                webSearch: true,
                shellCommandAllowlistAdditions: [],
                shellCommandAllowlistRemovals: [],
              },
              workspace: {
                strategy: "git_worktree",
                promoted: false,
              },
              stopPolicy: {
                repeatedFailures: 3,
                noMeaningfulProgress: 5,
                insufficientEvidence: 3,
              },
              progress: {
                completedCycles: 2,
                nextCycle: 3,
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
                resumeFromCycle: 3,
                requiresUserConfirmation: false,
              },
              createdAt: "2026-04-12T00:00:00.000Z",
              updatedAt: "2026-04-12T00:12:00.000Z",
            },
            cycle: {
              completedCycles: 2,
              nextCycle: 3,
              latestFrontierIds: [],
              sessionResolution: {
                decision: "replace",
                session: {
                  sessionId: "session-replace-001",
                },
                lifecycle: {
                  sessionId: "session-replace-001",
                  workingDirectory: tempRoot,
                  goal: "improve future holdout top-3 accuracy",
                  resumeFromCycle: 3,
                  completedCycles: 2,
                  command: "codex",
                  args: ["continue"],
                  approvalPolicy: "never",
                  sandboxMode: "workspace-write",
                  startedAt: "2026-04-12T00:00:00.000Z",
                  updatedAt: "2026-04-12T00:12:00.000Z",
                  phase: "running",
                  pid: 99,
                  identity: {
                    researchSessionId: "session-replace-001",
                    codexSessionId: "session-replace-001",
                    agent: "codex_cli",
                  },
                  tty: {
                    stdinIsTty: true,
                    stdoutIsTty: true,
                    startupTimeoutSec: 30,
                    turnTimeoutSec: 900,
                  },
                  attachmentState: {
                    mode: "working_directory",
                    status: "bound",
                    workingDirectory: tempRoot,
                    trackedGlobs: ["**/*.ts"],
                    attachedPaths: [],
                    extraWritableDirectories: [tempRoot],
                  },
                  references: {
                    checkpointRunId: "run-002",
                    checkpointDecisionId: "decision-002",
                  },
                },
                recovery: {
                  classification: "resumable",
                  resumeAllowed: true,
                  reason: "Codex CLI is no longer live; resume from completed cycle boundary 3",
                  runtime: {
                    state: "stale",
                    processAlive: false,
                    stale: true,
                    phase: "running",
                  },
                },
                codexSessionReference: {
                  codexSessionId: "session-replace-001",
                  lifecyclePath: join(tempRoot, ".ralph", "sessions", "session-replace-001", "codex-session.json"),
                },
                reason: "Codex CLI is no longer live; resume from completed cycle boundary 3",
                replace: {
                  runtimeState: "stale",
                  completedCycles: 2,
                  resumeFromCycle: 3,
                  resumable: true,
                  reason: "Codex CLI is no longer live; resume from completed cycle boundary 3",
                  attachabilityMode: "resume",
                  phase: "running",
                  attachmentStatus: "bound",
                },
              },
            },
          }),
          recordCodexSessionLifecycle,
          recordInterruption: vi.fn(async () => ({
            step: "session_interrupted",
            session: {
              sessionId: "session-replace-001",
              status: "awaiting_resume",
              progress: {
                completedCycles: 2,
                nextCycle: 3,
                latestFrontierIds: [],
                repeatedFailureStreak: 0,
                noMeaningfulProgressStreak: 0,
                insufficientEvidenceStreak: 0,
              },
              resume: {
                resumable: true,
                checkpointType: "completed_cycle_boundary",
                resumeFromCycle: 3,
                requiresUserConfirmation: true,
              },
            },
            cycle: {
              completedCycles: 2,
              nextCycle: 3,
              latestFrontierIds: [],
            },
          })),
          failSession: vi.fn(),
        }) as never,
      createSessionManager: () =>
        ({
          startSession,
          reattachSession: vi.fn(),
        }) as never,
    });

    const result = await service.continueSession({
      repoRoot: tempRoot,
      sessionId: "session-replace-001",
    });

    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-replace-001",
      }),
    );
    expect(startSession.mock.calls[0]?.[0]).not.toHaveProperty("existingSessionId");
    expect(recordCodexSessionLifecycle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        repoRoot: expect.stringContaining("ralph-research-session-interactive-"),
        sessionId: "session-replace-001",
        phase: "running",
        pid: 99,
        attachmentStatus: "released",
        args: ["continue"],
      }),
    );
    expect(recordCodexSessionLifecycle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        repoRoot: expect.stringContaining("ralph-research-session-interactive-"),
        sessionId: "session-replace-001",
        phase: "running",
        pid: 123,
        attachmentStatus: "bound",
        args: ["continue"],
      }),
    );
    expect(recordCodexSessionLifecycle).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        repoRoot: expect.stringContaining("ralph-research-session-interactive-"),
        sessionId: "session-replace-001",
        phase: "clean_exit",
        pid: 123,
        attachmentStatus: "released",
        args: ["continue"],
        exit: {
          code: 0,
          signal: null,
        },
      }),
    );
    expect(result.resumed.step).toBe("session_resumed");
    expect(result.finalized.step).toBe("session_interrupted");
  });

  it("reuses a live persisted Codex session and preserves lifecycle evidence end to end", async () => {
    const sessionId = "session-live-end-to-end";
    await savePersistedSessionBundle({
      session: makeRunningSession({
        sessionId,
      }),
      lifecycle: makePersistedLifecycle({
        sessionId,
        pid: 9911,
        identity: {
          researchSessionId: sessionId,
          codexSessionId: "codex-live-9911",
          agent: "codex_cli",
        },
      }),
    });

    const lifecyclePath = join(tempRoot, ".ralph", "sessions", sessionId, "codex-session.json");
    let lifecycleAtReattach: CodexCliSessionLifecycleRecord | null = null;
    const startSession = vi.fn(() => {
      throw new Error("startSession should not be called for a reusable session");
    });
    const reattachSession = vi.fn(() => {
      lifecycleAtReattach = parseCodexCliSessionLifecycleRecord(
        readFileSync(lifecyclePath, "utf8"),
      );
      return {
        pid: 9911,
        command: "codex",
        args: ["continue"],
        tty: {
          stdinIsTty: true,
          stdoutIsTty: true,
          startupTimeoutSec: 30,
          turnTimeoutSec: 900,
        },
        waitForExit: async () => ({
          code: 0,
          signal: null,
        }),
        stop: async () => ({
          code: null,
          signal: "SIGTERM" as const,
        }),
      };
    });

    const service = new ResearchSessionInteractiveService({
      createOrchestrator: () => createEndToEndOrchestrator({ processAlive: true }),
      createSessionManager: () =>
        ({
          startSession,
          reattachSession,
        }) as never,
    });

    const result = await service.continueSession({
      repoRoot: tempRoot,
      sessionId,
    });

    expect(result.resumed.cycle.sessionResolution?.decision).toBe("reuse");
    expect(startSession).not.toHaveBeenCalled();
    expect(reattachSession).toHaveBeenCalledWith({
      sessionId,
      codexSessionId: "codex-live-9911",
    });
    expect(lifecycleAtReattach).toMatchObject({
      sessionId,
      pid: 9911,
      phase: "running",
      identity: {
        codexSessionId: "codex-live-9911",
      },
      attachmentState: {
        status: "bound",
      },
      references: {
        checkpointRunId: "run-002",
        checkpointDecisionId: "decision-002",
      },
    });

    const persistedSession = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(join(tempRoot, ".ralph", "sessions", sessionId, "session.json"), "utf8")),
    );
    expect(persistedSession).toMatchObject({
      sessionId,
      status: "awaiting_resume",
      progress: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
      },
      resume: {
        resumeFromCycle: 3,
        checkpointRunId: "run-002",
        checkpointDecisionId: "decision-002",
        requiresUserConfirmation: true,
      },
    });

    const persistedLifecycle = parseCodexCliSessionLifecycleRecord(
      await readFile(lifecyclePath, "utf8"),
    );
    expect(persistedLifecycle).toMatchObject({
      sessionId,
      pid: 9911,
      phase: "clean_exit",
      args: ["continue"],
      identity: {
        codexSessionId: "codex-live-9911",
      },
      attachmentState: {
        status: "released",
      },
      references: {
        checkpointRunId: "run-002",
        checkpointDecisionId: "decision-002",
      },
      exit: {
        code: 0,
        signal: null,
      },
    });
    expect(result.finalized.session.resume.note).toContain(".ralph/sessions/session-live-end-to-end/codex-session.json");
  });

  it("replaces a stale persisted Codex session and checkpoints detach-plus-restart lifecycle evidence end to end", async () => {
    const sessionId = "session-stale-end-to-end";
    await savePersistedSessionBundle({
      session: makeRunningSession({
        sessionId,
      }),
      lifecycle: makePersistedLifecycle({
        sessionId,
        pid: 5511,
        identity: {
          researchSessionId: sessionId,
          codexSessionId: "codex-stale-5511",
          agent: "codex_cli",
        },
      }),
    });

    const lifecyclePath = join(tempRoot, ".ralph", "sessions", sessionId, "codex-session.json");
    let lifecycleAtReplacementStart: CodexCliSessionLifecycleRecord | null = null;
    const startSession = vi.fn(() => {
      lifecycleAtReplacementStart = parseCodexCliSessionLifecycleRecord(
        readFileSync(lifecyclePath, "utf8"),
      );
      return {
        pid: 6622,
        command: "codex",
        args: ["continue"],
        tty: {
          stdinIsTty: true,
          stdoutIsTty: true,
          startupTimeoutSec: 30,
          turnTimeoutSec: 900,
        },
        waitForExit: async () => ({
          code: 0,
          signal: null,
        }),
        stop: async () => ({
          code: null,
          signal: "SIGTERM" as const,
        }),
      };
    });
    const reattachSession = vi.fn(() => {
      throw new Error("reattachSession should not be called for a stale session");
    });

    const service = new ResearchSessionInteractiveService({
      createOrchestrator: () => createEndToEndOrchestrator({ processAlive: false }),
      createSessionManager: () =>
        ({
          startSession,
          reattachSession,
        }) as never,
    });

    const result = await service.continueSession({
      repoRoot: tempRoot,
      sessionId,
    });

    expect(result.resumed.cycle.sessionResolution?.decision).toBe("replace");
    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        cwd: tempRoot,
        existingSessionId: "codex-stale-5511",
      }),
    );
    expect(reattachSession).not.toHaveBeenCalled();
    expect(lifecycleAtReplacementStart).toMatchObject({
      sessionId,
      pid: 5511,
      phase: "running",
      identity: {
        codexSessionId: "codex-stale-5511",
      },
      attachmentState: {
        status: "released",
      },
      references: {
        checkpointRunId: "run-002",
        checkpointDecisionId: "decision-002",
      },
    });

    const persistedSession = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(join(tempRoot, ".ralph", "sessions", sessionId, "session.json"), "utf8")),
    );
    expect(persistedSession).toMatchObject({
      sessionId,
      status: "awaiting_resume",
      progress: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
      },
      resume: {
        resumeFromCycle: 3,
        checkpointRunId: "run-002",
        checkpointDecisionId: "decision-002",
        requiresUserConfirmation: true,
      },
    });

    const persistedLifecycle = parseCodexCliSessionLifecycleRecord(
      await readFile(lifecyclePath, "utf8"),
    );
    expect(persistedLifecycle).toMatchObject({
      sessionId,
      pid: 6622,
      phase: "clean_exit",
      args: ["continue"],
      identity: {
        codexSessionId: "codex-stale-5511",
      },
      attachmentState: {
        status: "released",
      },
      references: {
        checkpointRunId: "run-002",
        checkpointDecisionId: "decision-002",
      },
      exit: {
        code: 0,
        signal: null,
      },
    });
    expect(result.finalized.session.resume.note).toContain(".ralph/sessions/session-stale-end-to-end/codex-session.json");
  });

  it("starts a fresh Codex session when the persisted lifecycle bundle is missing", async () => {
    const sessionId = "session-missing-lifecycle";
    const canonicalRepoRoot = await realpath(tempRoot);
    const repository = new JsonFileResearchSessionRepository(join(tempRoot, ".ralph", "sessions"));
    await repository.saveSession(
      makeRunningSession({
        sessionId,
      }),
    );

    const startSession = vi.fn(() => ({
      pid: 7722,
      command: "codex",
      args: ["continue"],
      tty: {
        stdinIsTty: true,
        stdoutIsTty: true,
        startupTimeoutSec: 30,
        turnTimeoutSec: 900,
      },
      waitForExit: async () => ({
        code: 0,
        signal: null,
      }),
      stop: async () => ({
        code: null,
        signal: "SIGTERM" as const,
      }),
    }));
    const reattachSession = vi.fn(() => {
      throw new Error("reattachSession should not be called when lifecycle evidence is missing");
    });

    const service = new ResearchSessionInteractiveService({
      createOrchestrator: () => createEndToEndOrchestrator({ processAlive: false }),
      createSessionManager: () =>
        ({
          startSession,
          reattachSession,
        }) as never,
    });

    const result = await service.continueSession({
      repoRoot: tempRoot,
      sessionId,
    });

    expect(result.resumed.cycle.sessionResolution).toMatchObject({
      decision: "replace",
      replace: {
        runtimeState: "missing",
        resumable: false,
        attachabilityMode: "inspect",
      },
    });
    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        cwd: tempRoot,
        extraWritableDirectories: [canonicalRepoRoot],
      }),
    );
    expect(startSession.mock.calls[0]?.[0]).not.toHaveProperty("existingSessionId");
    expect(reattachSession).not.toHaveBeenCalled();

    const persistedLifecycle = parseCodexCliSessionLifecycleRecord(
      await readFile(join(tempRoot, ".ralph", "sessions", sessionId, "codex-session.json"), "utf8"),
    );
    expect(persistedLifecycle).toMatchObject({
      sessionId,
      pid: 7722,
      phase: "clean_exit",
      args: ["continue"],
      attachmentState: {
        status: "released",
      },
      exit: {
        code: 0,
        signal: null,
      },
    });
    expect(result.finalized.session.status).toBe("awaiting_resume");
  });

  it("starts a fresh Codex session when the persisted lifecycle is live but no longer attachable", async () => {
    const sessionId = "session-released-attachment";
    const canonicalRepoRoot = await realpath(tempRoot);
    await savePersistedSessionBundle({
      session: makeRunningSession({
        sessionId,
      }),
      lifecycle: makePersistedLifecycle({
        sessionId,
        pid: 8811,
        identity: {
          researchSessionId: sessionId,
          codexSessionId: sessionId,
          agent: "codex_cli",
        },
        attachmentState: {
          mode: "working_directory",
          status: "released",
          workingDirectory: tempRoot,
          trackedGlobs: ["**/*.ts"],
          attachedPaths: [],
          extraWritableDirectories: [tempRoot],
        },
      }),
    });

    const startSession = vi.fn(() => ({
      pid: 8822,
      command: "codex",
      args: ["continue"],
      tty: {
        stdinIsTty: true,
        stdoutIsTty: true,
        startupTimeoutSec: 30,
        turnTimeoutSec: 900,
      },
      waitForExit: async () => ({
        code: 0,
        signal: null,
      }),
      stop: async () => ({
        code: null,
        signal: "SIGTERM" as const,
      }),
    }));
    const reattachSession = vi.fn(() => {
      throw new Error("reattachSession should not be called when the lifecycle is no longer attachable");
    });

    const service = new ResearchSessionInteractiveService({
      createOrchestrator: () => createEndToEndOrchestrator({ processAlive: true }),
      createSessionManager: () =>
        ({
          startSession,
          reattachSession,
        }) as never,
    });

    const result = await service.continueSession({
      repoRoot: tempRoot,
      sessionId,
    });

    expect(result.resumed.cycle.sessionResolution).toMatchObject({
      decision: "replace",
      replace: {
        runtimeState: "active",
        resumable: false,
        attachabilityMode: "inspect",
        attachmentStatus: "released",
      },
    });
    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        cwd: tempRoot,
        extraWritableDirectories: [canonicalRepoRoot],
      }),
    );
    expect(startSession.mock.calls[0]?.[0]).not.toHaveProperty("existingSessionId");
    expect(reattachSession).not.toHaveBeenCalled();

    const persistedLifecycle = parseCodexCliSessionLifecycleRecord(
      await readFile(join(tempRoot, ".ralph", "sessions", sessionId, "codex-session.json"), "utf8"),
    );
    expect(persistedLifecycle).toMatchObject({
      sessionId,
      pid: 8822,
      phase: "clean_exit",
      args: ["continue"],
      attachmentState: {
        status: "released",
      },
      exit: {
        code: 0,
        signal: null,
      },
    });
    expect(result.finalized.session.status).toBe("awaiting_resume");
  });

  it("reuses the same persisted Codex session after checkpointing a completed cycle boundary", async () => {
    const sessionId = "session-cycle-boundary";
    const lifecyclePath = join(tempRoot, ".ralph", "sessions", sessionId, "codex-session.json");
    const workspacePath = join(tempRoot, ".ralph", "workspaces", "candidate-003");
    const checkpointingService = new ResearchSessionOrchestratorService({
      now: createTickingClock("2026-04-12T00:14:00.000Z"),
    });
    const repository = new JsonFileResearchSessionRepository(join(tempRoot, ".ralph", "sessions"));

    await repository.saveSession(
      makeRunningSession({
        sessionId,
        workspace: {
          strategy: "git_worktree",
          currentRef: `refs/heads/${sessionId}`,
          currentPath: join(tempRoot, ".ralph", "sessions", sessionId, "worktree"),
          promoted: false,
        },
      }),
    );

    await checkpointingService.recordCodexSessionLifecycle({
      repoRoot: tempRoot,
      sessionId,
      phase: "running",
      command: "codex",
      args: ["continue"],
      pid: 9911,
      attachmentStatus: "bound",
    });
    await checkpointingService.recordCompletedCycle({
      repoRoot: tempRoot,
      sessionId,
      run: {
        runId: "run-003",
        cycle: 3,
        candidateId: "candidate-003",
        status: "accepted",
        phase: "completed",
        pendingAction: "none",
        startedAt: "2026-04-12T00:13:00.000Z",
        endedAt: "2026-04-12T00:13:45.000Z",
        manifestHash: "manifest-003",
        workspaceRef: "refs/heads/candidate-003",
        workspacePath,
        proposal: {
          proposerType: "codex_cli",
          summary: "Persisted the completed cycle 3 evidence bundle.",
          diffLines: 24,
          filesChanged: 3,
          changedPaths: ["reports/cycle-003.json", "reports/future-holdout.json"],
          withinBudget: true,
          operators: [],
        },
        artifacts: [],
        metrics: {},
        constraints: [],
        logs: {},
      },
      decision: {
        decisionId: "decision-003",
        runId: "run-003",
        outcome: "accepted",
        actorType: "system",
        policyType: "ratchet",
        frontierChanged: true,
        delta: 0.08,
        reason: "Cycle 3 improved the future holdout verifier.",
        createdAt: "2026-04-12T00:13:46.000Z",
        beforeFrontierIds: ["frontier-002"],
        afterFrontierIds: ["frontier-003"],
      },
      frontierIds: ["frontier-003"],
      signal: {
        outcome: "accepted",
        changedFileCount: 3,
        diffLineCount: 24,
        repeatedDiff: false,
        verificationDelta: 0.08,
        newArtifacts: ["reports/cycle-003.json", "reports/future-holdout.json"],
        meaningfulProgress: true,
        insufficientEvidence: false,
        agentTieBreakerUsed: false,
        reasons: ["Persisted the completed cycle 3 evidence bundle."],
      },
    });

    let lifecycleAtReattach: CodexCliSessionLifecycleRecord | null = null;
    const startSession = vi.fn(() => {
      throw new Error("startSession should not be called when reusing a checkpointed live session");
    });
    const reattachSession = vi.fn(() => {
      lifecycleAtReattach = parseCodexCliSessionLifecycleRecord(
        readFileSync(lifecyclePath, "utf8"),
      );
      return {
        pid: 9911,
        command: "codex",
        args: ["continue"],
        tty: {
          stdinIsTty: true,
          stdoutIsTty: true,
          startupTimeoutSec: 30,
          turnTimeoutSec: 900,
        },
        waitForExit: async () => ({
          code: 0,
          signal: null,
        }),
        stop: async () => ({
          code: null,
          signal: "SIGTERM" as const,
        }),
      };
    });

    const service = new ResearchSessionInteractiveService({
      createOrchestrator: () => createEndToEndOrchestrator({ processAlive: true }),
      createSessionManager: () =>
        ({
          startSession,
          reattachSession,
        }) as never,
    });

    const result = await service.continueSession({
      repoRoot: tempRoot,
      sessionId,
    });

    expect(startSession).not.toHaveBeenCalled();
    expect(reattachSession).toHaveBeenCalledWith({
      sessionId,
      codexSessionId: sessionId,
    });
    expect(result.resumed.cycle.sessionResolution).toMatchObject({
      decision: "reuse",
      reuse: {
        researchSessionId: sessionId,
        codexSessionId: sessionId,
        pid: 9911,
        phase: "running",
        checkpointRunId: "run-003",
        checkpointDecisionId: "decision-003",
        workspaceRef: "refs/heads/candidate-003",
        workspacePath,
      },
    });
    expect(lifecycleAtReattach).toMatchObject({
      sessionId,
      pid: 9911,
      completedCycles: 3,
      resumeFromCycle: 4,
      identity: {
        codexSessionId: sessionId,
      },
      attachmentState: {
        status: "bound",
      },
      references: {
        checkpointRunId: "run-003",
        checkpointDecisionId: "decision-003",
        workspaceRef: "refs/heads/candidate-003",
        workspacePath,
      },
    });

    const persistedLifecycle = parseCodexCliSessionLifecycleRecord(
      await readFile(lifecyclePath, "utf8"),
    );
    expect(persistedLifecycle).toMatchObject({
      sessionId,
      pid: 9911,
      completedCycles: 3,
      resumeFromCycle: 4,
      phase: "clean_exit",
      identity: {
        codexSessionId: sessionId,
      },
      references: {
        checkpointRunId: "run-003",
        checkpointDecisionId: "decision-003",
        workspaceRef: "refs/heads/candidate-003",
        workspacePath,
      },
    });
  });
});

function createEndToEndOrchestrator(input: {
  processAlive: boolean;
}): ResearchSessionOrchestratorService {
  const createRepository = (sessionsRoot: string) => new JsonFileResearchSessionRepository(sessionsRoot);
  const createRecoveryService = () =>
    new ResearchSessionRecoveryService({
      createRepository,
      isProcessAlive: () => input.processAlive,
    });

  return new ResearchSessionOrchestratorService({
    now: createTickingClock("2026-04-12T00:20:00.000Z"),
    createRepository,
    createRecoveryService,
    createLifecycleService: () =>
      new CodexCliSessionLifecycleService({
        createRecoveryService,
      }),
  });
}

function createTickingClock(startAt: string): () => Date {
  const startTimestamp = Date.parse(startAt);
  let tick = 0;
  return () => new Date(startTimestamp + tick++ * 1_000);
}

function makeRunningSession(overrides: Partial<ResearchSessionRecord> = {}): ResearchSessionRecord {
  return researchSessionRecordSchema.parse({
    sessionId: "session-001",
    goal: "improve future holdout top-3 accuracy",
    workingDirectory: tempRoot,
    status: "running",
    agent: {
      type: "codex_cli",
      command: "codex",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      ttySession: {
        startupTimeoutSec: 30,
        turnTimeoutSec: 900,
      },
    },
    context: {
      trackableGlobs: ["**/*.ts"],
      webSearch: true,
      shellCommandAllowlistAdditions: [],
      shellCommandAllowlistRemovals: [],
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
      completedCycles: 2,
      nextCycle: 3,
      latestRunId: "run-002",
      latestDecisionId: "decision-002",
      latestFrontierIds: ["frontier-001", "frontier-002"],
      repeatedFailureStreak: 0,
      noMeaningfulProgressStreak: 0,
      insufficientEvidenceStreak: 0,
      lastMeaningfulProgressCycle: 2,
      lastCheckpointAt: "2026-04-12T00:10:00.000Z",
      lastSignals: {
        cycle: 2,
        outcome: "accepted",
        changedFileCount: 2,
        diffLineCount: 18,
        meaningfulProgress: true,
        insufficientEvidence: false,
        agentTieBreakerUsed: false,
        reasons: ["Persisted the cycle 2 checkpoint bundle."],
        newArtifacts: ["reports/cycle-002.json"],
        repeatedDiff: false,
      },
    },
    stopCondition: {
      type: "none",
    },
    resume: {
      resumable: true,
      checkpointType: "completed_cycle_boundary",
      resumeFromCycle: 3,
      requiresUserConfirmation: false,
      checkpointRunId: "run-002",
      checkpointDecisionId: "decision-002",
    },
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:12:00.000Z",
    ...overrides,
  });
}

function makePersistedLifecycle(
  overrides: Partial<CodexCliSessionLifecycleRecord> = {},
): CodexCliSessionLifecycleRecord {
  return {
    sessionId: "session-001",
    workingDirectory: tempRoot,
    goal: "improve future holdout top-3 accuracy",
    resumeFromCycle: 3,
    completedCycles: 2,
    command: "codex",
    args: ["continue"],
    approvalPolicy: "never",
    sandboxMode: "workspace-write",
    startedAt: "2026-04-12T00:10:30.000Z",
    updatedAt: "2026-04-12T00:12:00.000Z",
    phase: "running",
    pid: 3131,
    identity: {
      researchSessionId: "session-001",
      codexSessionId: "session-001",
      agent: "codex_cli",
    },
    tty: {
      stdinIsTty: true,
      stdoutIsTty: true,
      startupTimeoutSec: 30,
      turnTimeoutSec: 900,
    },
    attachmentState: {
      mode: "working_directory",
      status: "bound",
      workingDirectory: tempRoot,
      trackedGlobs: ["**/*.ts"],
      attachedPaths: [],
      extraWritableDirectories: [tempRoot],
    },
    references: {
      workspaceRef: "refs/heads/session-001",
      workspacePath: join(tempRoot, ".ralph", "sessions", "session-001", "worktree"),
      checkpointRunId: "run-002",
      checkpointDecisionId: "decision-002",
    },
    ...overrides,
  };
}

async function savePersistedSessionBundle(input: {
  session: ResearchSessionRecord;
  lifecycle: CodexCliSessionLifecycleRecord;
}): Promise<void> {
  const repository = new JsonFileResearchSessionRepository(join(tempRoot, ".ralph", "sessions"));
  await repository.saveSession(input.session);
  await mkdir(join(tempRoot, ".ralph", "sessions", input.session.sessionId), {
    recursive: true,
  });
  await writeFile(
    join(tempRoot, ".ralph", "sessions", input.session.sessionId, "codex-session.json"),
    serializeCodexCliSessionLifecycleRecord(input.lifecycle),
    "utf8",
  );
}
