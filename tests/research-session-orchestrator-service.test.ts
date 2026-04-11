import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonFileResearchSessionRepository } from "../src/adapters/fs/json-file-research-session-repository.js";
import { CodexCliSessionLifecycleService } from "../src/app/services/codex-cli-session-lifecycle-service.js";
import { ResearchSessionDraftService } from "../src/app/services/research-session-draft-service.js";
import { ResearchSessionLaunchService } from "../src/app/services/research-session-launch-service.js";
import { ResearchSessionOrchestratorService } from "../src/app/services/research-session-orchestrator-service.js";
import { ResearchSessionRecoveryService } from "../src/app/services/research-session-recovery-service.js";
import { researchProjectDefaultsRecordSchema } from "../src/core/model/research-project-defaults.js";
import { researchSessionRecordSchema, type ResearchSessionRecord } from "../src/core/model/research-session.js";
import type { ResearchSessionRepository } from "../src/core/ports/research-session-repository.js";
import type { RunRecord } from "../src/core/model/run-record.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-session-orchestrator-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("ResearchSessionOrchestratorService", () => {
  it("starts a new running session from the saved launch draft in a separate session directory", async () => {
    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await launchService.launch({
      goal: "improve future holdout top-3 accuracy",
      repoRoot: tempRoot,
    });
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:05:00.000Z"),
      createSessionId: () => "session-20260412-000500",
    });

    const session = await service.startSession({
      repoRoot: tempRoot,
      draftSessionId: launch.sessionId,
    });

    expect(session).toMatchObject({
      step: "session_started",
      session: {
        sessionId: "session-20260412-000500",
        status: "running",
        goal: "improve future holdout top-3 accuracy",
        progress: {
          completedCycles: 0,
          nextCycle: 1,
        },
        resume: {
          resumeFromCycle: 1,
          requiresUserConfirmation: false,
        },
      },
      cycle: {
        completedCycles: 0,
        nextCycle: 1,
        latestFrontierIds: [],
      },
    });
    expect(session.session.createdAt).toBe("2026-04-12T00:05:00.000Z");
    expect(session.session.updatedAt).toBe("2026-04-12T00:05:00.000Z");

    const sessionPath = join(
      tempRoot,
      ".ralph",
      "sessions",
      "session-20260412-000500",
      "session.json",
    );
    await expect(access(sessionPath)).resolves.toBeUndefined();
    const persisted = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(sessionPath, "utf8")),
    );
    expect(persisted.sessionId).toBe("session-20260412-000500");
    expect(persisted.status).toBe("running");
    const lifecycle = JSON.parse(
      await readFile(
        join(
          tempRoot,
          ".ralph",
          "sessions",
          "session-20260412-000500",
          "codex-session.json",
        ),
        "utf8",
      ),
    );
    expect(lifecycle).toMatchObject({
      sessionId: "session-20260412-000500",
      phase: "starting",
      command: "codex",
      args: [],
      attachmentState: {
        status: "unknown",
        workingDirectory: session.session.workingDirectory,
      },
      references: {},
    });
    await expect(access(launch.sessionPath)).resolves.toBeUndefined();
  });

  it("starts a fresh session from launch-draft without mutating the resumable checkpoint selected for a new session choice", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(
      makeSession({
        sessionId: "session-existing-001",
        status: "awaiting_resume",
        workspace: {
          strategy: "git_worktree",
          currentRef: "refs/heads/session-existing-001",
          currentPath: join(tempRoot, ".ralph", "sessions", "session-existing-001", "worktree"),
          promoted: false,
        },
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-002"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 2,
          lastCheckpointAt: "2026-04-12T00:04:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 2,
            diffLineCount: 18,
            repeatedDiff: false,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            newArtifacts: ["reports/cycle-002.json"],
            reasons: ["Persisted the cycle 2 checkpoint bundle."],
          },
        },
        stopCondition: {
          type: "operator_stop",
          note: "Paused before cycle 3.",
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: true,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          interruptionDetectedAt: "2026-04-12T00:04:10.000Z",
          interruptedDuringCycle: 3,
          note: "TTY disconnected before cycle 3 completed.",
        },
      }),
    );

    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await launchService.launch({
      goal: "Reach 70% future holdout top-3 prediction success.",
      repoRoot: tempRoot,
    });
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:05:00.000Z"),
      createSessionId: () => "session-20260412-000500",
    });

    const started = await service.startSession({
      repoRoot: tempRoot,
      draftSessionId: launch.sessionId,
    });

    const persistedExisting = researchSessionRecordSchema.parse(
      JSON.parse(
        await readFile(
          join(tempRoot, ".ralph", "sessions", "session-existing-001", "session.json"),
          "utf8",
        ),
      ),
    );
    const persistedNewSession = researchSessionRecordSchema.parse(
      JSON.parse(
        await readFile(
          join(tempRoot, ".ralph", "sessions", "session-20260412-000500", "session.json"),
          "utf8",
        ),
      ),
    );
    const persistedSessionIds = (await readdir(join(tempRoot, ".ralph", "sessions"))).sort();

    expect(started).toMatchObject({
      step: "session_started",
      session: {
        sessionId: "session-20260412-000500",
        status: "running",
        progress: {
          completedCycles: 0,
          nextCycle: 1,
        },
      },
    });
    expect(started.session.sessionId).not.toBe("session-existing-001");
    expect(persistedExisting).toMatchObject({
      sessionId: "session-existing-001",
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
    expect(persistedNewSession).toMatchObject({
      sessionId: "session-20260412-000500",
      status: "running",
      progress: {
        completedCycles: 0,
        nextCycle: 1,
        latestFrontierIds: [],
      },
      resume: {
        resumeFromCycle: 1,
        requiresUserConfirmation: false,
      },
    });
    expect(persistedSessionIds).toEqual([
      "launch-draft",
      "session-20260412-000500",
      "session-existing-001",
    ]);
  });

  it("freezes the submitted review snapshot after submission while later draft/default edits stay outside the started session", async () => {
    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const draftService = new ResearchSessionDraftService({
      now: () => new Date("2026-04-12T00:01:00.000Z"),
    });
    const orchestrator = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:02:00.000Z"),
      createSessionId: () => "session-20260412-000200",
    });
    const canonicalRoot = await realpath(tempRoot);
    const reportsDirectory = join(canonicalRoot, "reports");
    const holdoutDirectory = join(canonicalRoot, "holdout");
    await mkdir(reportsDirectory, { recursive: true });
    await mkdir(holdoutDirectory, { recursive: true });

    const launch = await launchService.launch({
      goal: "improve future holdout top-3 accuracy",
      repoRoot: tempRoot,
    });

    await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        currentStep: "review",
        completedSteps: ["permissions", "stopRules", "outputs", "review"],
        reviewConfirmed: true,
        workingDirectory: reportsDirectory,
        contextSettings: {
          webSearch: "disabled",
          trackableGlobs: "reports/**/*.json, src/**/*.ts",
        },
        workspaceSettings: {
          baseRef: "origin/main",
        },
        agentCommand: "codex --model gpt-5.4 --full-auto",
        stopPolicy: {
          repeatedFailures: "4",
          noMeaningfulProgress: "6",
          insufficientEvidence: "2",
        },
      },
    });

    const started = await orchestrator.startSession({
      repoRoot: tempRoot,
      draftSessionId: launch.sessionId,
    });

    await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        currentStep: "outputs",
        reviewConfirmed: false,
        workingDirectory: holdoutDirectory,
        contextSettings: {
          webSearch: "enabled",
          trackableGlobs: "holdout/**/*.json",
        },
        workspaceSettings: {
          baseRef: "HEAD~1",
        },
        agentCommand: "codex --model gpt-5.4-mini",
        stopPolicy: {
          repeatedFailures: "7",
          noMeaningfulProgress: "8",
          insufficientEvidence: "5",
        },
      },
    });

    const startedSessionPath = join(
      canonicalRoot,
      ".ralph",
      "sessions",
      "session-20260412-000200",
      "session.json",
    );
    const persistedStarted = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(startedSessionPath, "utf8")),
    );
    const persistedDefaults = researchProjectDefaultsRecordSchema.parse(
      JSON.parse(
        await readFile(join(canonicalRoot, ".ralph", "project-defaults.json"), "utf8"),
      ),
    );

    expect(started.session.draftState).toMatchObject({
      currentStep: "review",
      completedSteps: ["permissions", "stopRules", "outputs", "review"],
      reviewConfirmed: true,
      flowState: {
        permissions: {
          workingDirectory: reportsDirectory,
          webSearch: "disabled",
        },
        outputs: {
          goal: "improve future holdout top-3 accuracy",
          trackableGlobs: "reports/**/*.json, src/**/*.ts",
          baseRef: "origin/main",
          agentCommand: "codex --model gpt-5.4 --full-auto",
        },
        stopRules: {
          repeatedFailures: "4",
          noMeaningfulProgress: "6",
          insufficientEvidence: "2",
        },
      },
    });
    expect(started.session.submittedSnapshot).toMatchObject({
      sessionId: "session-20260412-000200",
      status: "running",
      workingDirectory: reportsDirectory,
      context: {
        trackableGlobs: ["reports/**/*.json", "src/**/*.ts"],
        webSearch: false,
      },
      workspace: {
        baseRef: "origin/main",
        promoted: false,
      },
      agent: {
        command: "codex --model gpt-5.4 --full-auto",
      },
      stopPolicy: {
        repeatedFailures: 4,
        noMeaningfulProgress: 6,
        insufficientEvidence: 2,
      },
      progress: {
        completedCycles: 0,
        nextCycle: 1,
        latestFrontierIds: [],
      },
      resume: {
        resumeFromCycle: 1,
        requiresUserConfirmation: false,
      },
      createdAt: "2026-04-12T00:02:00.000Z",
      updatedAt: "2026-04-12T00:02:00.000Z",
    });
    expect(persistedStarted).toMatchObject({
      sessionId: "session-20260412-000200",
      status: "running",
      workingDirectory: reportsDirectory,
      context: {
        trackableGlobs: ["reports/**/*.json", "src/**/*.ts"],
        webSearch: false,
      },
      workspace: {
        baseRef: "origin/main",
      },
      agent: {
        command: "codex --model gpt-5.4 --full-auto",
      },
      stopPolicy: {
        repeatedFailures: 4,
        noMeaningfulProgress: 6,
        insufficientEvidence: 2,
      },
      draftState: {
        currentStep: "review",
        completedSteps: ["permissions", "stopRules", "outputs", "review"],
        reviewConfirmed: true,
      },
      submittedSnapshot: {
        sessionId: "session-20260412-000200",
        status: "running",
        workingDirectory: reportsDirectory,
        context: {
          trackableGlobs: ["reports/**/*.json", "src/**/*.ts"],
          webSearch: false,
        },
        workspace: {
          baseRef: "origin/main",
        },
        agent: {
          command: "codex --model gpt-5.4 --full-auto",
        },
        stopPolicy: {
          repeatedFailures: 4,
          noMeaningfulProgress: 6,
          insufficientEvidence: 2,
        },
        progress: {
          completedCycles: 0,
          nextCycle: 1,
          latestFrontierIds: [],
        },
        resume: {
          resumeFromCycle: 1,
          requiresUserConfirmation: false,
        },
      },
    });
    expect(persistedStarted.draftState?.flowState?.permissions?.workingDirectory).toBe(reportsDirectory);
    expect(persistedStarted.draftState?.flowState?.outputs?.trackableGlobs).toBe(
      "reports/**/*.json, src/**/*.ts",
    );
    expect(persistedStarted.draftState?.flowState?.outputs?.agentCommand).toBe(
      "codex --model gpt-5.4 --full-auto",
    );
    expect(persistedStarted.draftState?.flowState?.outputs?.baseRef).toBe("origin/main");
    expect(persistedStarted.submittedSnapshot?.workspace.currentRef).toBeUndefined();
    expect(persistedStarted.submittedSnapshot?.progress.latestRunId).toBeUndefined();
    expect(persistedDefaults).toMatchObject({
      workingDirectory: holdoutDirectory,
      context: {
        trackableGlobs: ["holdout/**/*.json"],
        webSearch: true,
      },
      workspace: {
        baseRef: "HEAD~1",
      },
      agent: {
        command: "codex --model gpt-5.4-mini",
      },
      stopPolicy: {
        repeatedFailures: 7,
        noMeaningfulProgress: 8,
        insufficientEvidence: 5,
      },
    });
  });

  it("restores resumable sessions to running without discarding the last completed checkpoint", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(
      makeSession({
        status: "awaiting_resume",
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-002"],
          repeatedFailureStreak: 1,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 2,
          lastCheckpointAt: "2026-04-12T00:10:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 3,
            diffLineCount: 41,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["Generated the latest holdout report."],
            newArtifacts: ["reports/holdout-002.json"],
            repeatedDiff: false,
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: true,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          interruptionDetectedAt: "2026-04-12T00:11:00.000Z",
          interruptedDuringCycle: 3,
          note: "TTY disconnected",
        },
      }),
    );
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:12:00.000Z"),
      recoveryService: {
        classifySession: async () => ({
          classification: "resumable",
          resumeAllowed: true,
          reason: "Codex CLI exited cleanly before cycle 3 completed",
          runtime: {
            state: "exited",
            processAlive: false,
            stale: false,
            phase: "clean_exit",
          },
        }),
      },
    });

    const resumed = await service.resumeSession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(resumed).toMatchObject({
      step: "session_resumed",
      session: {
        sessionId: "session-001",
        status: "running",
        stopCondition: {
          type: "none",
        },
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
          requiresUserConfirmation: false,
        },
      },
      cycle: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-002"],
      },
    });
    expect(resumed.session.resume.interruptionDetectedAt).toBeUndefined();
    expect(resumed.session.resume.interruptedDuringCycle).toBeUndefined();
    expect(resumed.session.resume.note).toBeUndefined();
    expect(resumed.session.updatedAt).toBe("2026-04-12T00:12:00.000Z");
  });

  it("continues the existing resumable session without reopening launch-draft state when resume is chosen", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(
      makeSession({
        sessionId: "session-existing-001",
        status: "awaiting_resume",
        workspace: {
          strategy: "git_worktree",
          currentRef: "refs/heads/session-existing-001",
          currentPath: join(tempRoot, ".ralph", "sessions", "session-existing-001", "worktree"),
          promoted: false,
        },
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-002"],
          repeatedFailureStreak: 1,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 2,
          lastCheckpointAt: "2026-04-12T00:10:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 3,
            diffLineCount: 41,
            repeatedDiff: false,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            newArtifacts: ["reports/holdout-002.json"],
            reasons: ["Generated the latest holdout report."],
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: true,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          interruptionDetectedAt: "2026-04-12T00:11:00.000Z",
          interruptedDuringCycle: 3,
          note: "TTY disconnected",
        },
      }),
    );

    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await launchService.launch({
      goal: "Reach 70% future holdout top-3 prediction success.",
      repoRoot: tempRoot,
    });
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:12:00.000Z"),
      recoveryService: {
        classifySession: async () => ({
          classification: "resumable",
          resumeAllowed: true,
          reason: "Codex CLI exited cleanly before cycle 3 completed",
          runtime: {
            state: "exited",
            processAlive: false,
            stale: false,
            phase: "clean_exit",
          },
        }),
      },
    });

    const resumed = await service.continueSession({
      repoRoot: tempRoot,
      sessionId: "session-existing-001",
    });

    const persistedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(launch.sessionPath, "utf8")),
    );
    const persistedResumed = researchSessionRecordSchema.parse(
      JSON.parse(
        await readFile(
          join(tempRoot, ".ralph", "sessions", "session-existing-001", "session.json"),
          "utf8",
        ),
      ),
    );
    const persistedSessionIds = (await readdir(join(tempRoot, ".ralph", "sessions"))).sort();

    expect(resumed).toMatchObject({
      step: "session_resumed",
      session: {
        sessionId: "session-existing-001",
        status: "running",
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
          requiresUserConfirmation: false,
        },
      },
    });
    expect(persistedDraft).toMatchObject({
      sessionId: "launch-draft",
      status: "draft",
      progress: {
        completedCycles: 0,
        nextCycle: 1,
      },
    });
    expect(persistedResumed).toMatchObject({
      sessionId: "session-existing-001",
      status: "running",
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
        requiresUserConfirmation: false,
      },
    });
    expect(persistedSessionIds).toEqual(["launch-draft", "session-existing-001"]);
  });

  it("allows stale running sessions to resume from the persisted completed-cycle checkpoint", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(
      makeSession({
        status: "running",
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-002"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 2,
          lastCheckpointAt: "2026-04-12T00:10:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 3,
            diffLineCount: 41,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["Generated the latest holdout report."],
            newArtifacts: ["reports/holdout-002.json"],
            repeatedDiff: false,
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: false,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
        },
      }),
    );
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:12:00.000Z"),
      recoveryService: {
        classifySession: async () => ({
          classification: "resumable",
          resumeAllowed: true,
          reason: "Codex CLI is no longer live; resume from completed cycle boundary 3",
          runtime: {
            state: "stale",
            processAlive: false,
            stale: true,
            phase: "running",
          },
        }),
      },
    });

    const resumed = await service.resumeSession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(resumed).toMatchObject({
      step: "session_resumed",
      session: {
        sessionId: "session-001",
        status: "running",
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
          requiresUserConfirmation: false,
        },
      },
    });
  });

  it("refuses to resume awaiting_resume sessions when recovery classification is not safely resumable", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(
      makeSession({
        status: "awaiting_resume",
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-002"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 2,
          lastCheckpointAt: "2026-04-12T00:10:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 3,
            diffLineCount: 41,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["Generated the latest holdout report."],
            newArtifacts: ["reports/holdout-002.json"],
            repeatedDiff: false,
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: true,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          interruptionDetectedAt: "2026-04-12T00:11:00.000Z",
          interruptedDuringCycle: 3,
          note: "Lifecycle evidence missing.",
        },
      }),
    );
    const service = new ResearchSessionOrchestratorService({
      recoveryService: {
        classifySession: async () => ({
          classification: "inspect_only",
          resumeAllowed: false,
          reason: "awaiting_resume session is missing Codex lifecycle evidence",
          runtime: {
            state: "missing",
            processAlive: false,
            stale: false,
          },
        }),
      },
    });

    await expect(
      service.resumeSession({
        repoRoot: tempRoot,
        sessionId: "session-001",
      }),
    ).rejects.toThrow(
      "Session session-001 cannot resume safely: awaiting_resume session is missing Codex lifecycle evidence",
    );
  });

  it("reloads persisted session state before resuming and rejects statuses outside the allowlist", async () => {
    let loadCount = 0;
    const repository: ResearchSessionRepository = {
      saveSession: async () => {
        throw new Error("resume should not persist when the session becomes terminal");
      },
      loadSession: async (sessionId) => {
        if (sessionId !== "session-001") {
          return null;
        }

        loadCount += 1;
        if (loadCount === 1) {
          return makeSession({
            status: "awaiting_resume",
            progress: {
              completedCycles: 2,
              nextCycle: 3,
              latestRunId: "run-002",
              latestDecisionId: "decision-002",
              latestFrontierIds: ["frontier-002"],
              repeatedFailureStreak: 0,
              noMeaningfulProgressStreak: 0,
              insufficientEvidenceStreak: 0,
              lastMeaningfulProgressCycle: 2,
              lastCheckpointAt: "2026-04-12T00:10:00.000Z",
              lastSignals: {
                cycle: 2,
                outcome: "accepted",
                changedFileCount: 3,
                diffLineCount: 41,
                meaningfulProgress: true,
                insufficientEvidence: false,
                agentTieBreakerUsed: false,
                reasons: ["Generated the latest holdout report."],
                newArtifacts: ["reports/holdout-002.json"],
                repeatedDiff: false,
              },
            },
            resume: {
              resumable: true,
              checkpointType: "completed_cycle_boundary",
              resumeFromCycle: 3,
              requiresUserConfirmation: true,
              checkpointRunId: "run-002",
              checkpointDecisionId: "decision-002",
              interruptionDetectedAt: "2026-04-12T00:11:00.000Z",
              interruptedDuringCycle: 3,
              note: "TTY disconnected",
            },
          });
        }

        const resumableCheckpoint = makeSession({
          status: "awaiting_resume",
          progress: {
            completedCycles: 2,
            nextCycle: 3,
            latestRunId: "run-002",
            latestDecisionId: "decision-002",
            latestFrontierIds: ["frontier-002"],
            repeatedFailureStreak: 0,
            noMeaningfulProgressStreak: 0,
            insufficientEvidenceStreak: 0,
            lastMeaningfulProgressCycle: 2,
            lastCheckpointAt: "2026-04-12T00:10:00.000Z",
            lastSignals: {
              cycle: 2,
              outcome: "accepted",
              changedFileCount: 3,
              diffLineCount: 41,
              meaningfulProgress: true,
              insufficientEvidence: false,
              agentTieBreakerUsed: false,
              reasons: ["Generated the latest holdout report."],
              newArtifacts: ["reports/holdout-002.json"],
              repeatedDiff: false,
            },
          },
          resume: {
            resumable: true,
            checkpointType: "completed_cycle_boundary",
            resumeFromCycle: 3,
            requiresUserConfirmation: true,
            checkpointRunId: "run-002",
            checkpointDecisionId: "decision-002",
            interruptionDetectedAt: "2026-04-12T00:11:00.000Z",
            interruptedDuringCycle: 3,
            note: "TTY disconnected",
          },
        });

        return {
          ...resumableCheckpoint,
          status: "goal_achieved",
          stopCondition: {
            type: "goal_achieved",
            summary: "Future holdout top-3 success reached 72%.",
            achievedAtCycle: 2,
          },
          resume: {
            ...resumableCheckpoint.resume,
            resumable: false,
            requiresUserConfirmation: false,
          },
          evidenceBundlePath: ".ralph/sessions/session-001/evidence",
          updatedAt: "2026-04-12T00:12:00.000Z",
          endedAt: "2026-04-12T00:12:00.000Z",
        } satisfies ResearchSessionRecord;
      },
      querySessions: async () => [],
    };

    const service = new ResearchSessionOrchestratorService({
      createRepository: () => repository,
      recoveryService: {
        classifySession: async () => ({
          classification: "resumable",
          resumeAllowed: true,
          reason: "Codex CLI exited cleanly before cycle 3 completed",
          runtime: {
            state: "exited",
            processAlive: false,
            stale: false,
            phase: "clean_exit",
          },
        }),
      },
    });

    await expect(
      service.resumeSession({
        repoRoot: tempRoot,
        sessionId: "session-001",
      }),
    ).rejects.toThrow(
      "Session session-001 cannot resume from status goal_achieved; resumable statuses: running, awaiting_resume, halted",
    );
  });

  it("continues already-running sessions without rewriting the persisted checkpoint", async () => {
    const runningSession = makeSession({
      progress: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-002"],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
        lastMeaningfulProgressCycle: 2,
        lastCheckpointAt: "2026-04-12T00:10:00.000Z",
        lastSignals: {
          cycle: 2,
          outcome: "accepted",
          changedFileCount: 3,
          diffLineCount: 41,
          meaningfulProgress: true,
          insufficientEvidence: false,
          agentTieBreakerUsed: false,
          reasons: ["Generated the latest holdout report."],
          newArtifacts: ["reports/holdout-002.json"],
          repeatedDiff: false,
        },
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 3,
        requiresUserConfirmation: false,
        checkpointRunId: "run-002",
        checkpointDecisionId: "decision-002",
      },
    });
    const repository: ResearchSessionRepository = {
      saveSession: async () => {
        throw new Error("continueSession should not rewrite an already-running checkpoint");
      },
      loadSession: async (sessionId) => {
        if (sessionId !== runningSession.sessionId) {
          return null;
        }

        return runningSession;
      },
      querySessions: async () => [runningSession],
    };
    const service = new ResearchSessionOrchestratorService({
      createRepository: () => repository,
      lifecycleService: {
        resolveCycleSession: async () => ({
          decision: "replace",
          session: runningSession,
          lifecycle: null,
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
          codexSessionReference: null,
          reason: "Codex CLI is no longer live; resume from completed cycle boundary 3",
          replace: {
            runtimeState: "stale",
            completedCycles: 2,
            resumeFromCycle: 3,
            resumable: true,
            reason: "Codex CLI is no longer live; resume from completed cycle boundary 3",
            attachabilityMode: "resume",
            phase: "running",
          },
        }),
      },
    });

    const continued = await service.continueSession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(continued).toMatchObject({
      step: "session_resumed",
      session: runningSession,
      cycle: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-002"],
        lastSignals: runningSession.progress.lastSignals,
        sessionResolution: {
          decision: "replace",
          replace: {
            runtimeState: "stale",
            completedCycles: 2,
            resumeFromCycle: 3,
            resumable: true,
            reason: "Codex CLI is no longer live; resume from completed cycle boundary 3",
            attachabilityMode: "resume",
            phase: "running",
          },
          reason: "Codex CLI is no longer live; resume from completed cycle boundary 3",
        },
      },
    });
  });

  it("allows running sessions with missing Codex lifecycle evidence to fall back to replacement instead of throwing", async () => {
    const runningSession = makeSession({
      progress: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-002"],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
        lastMeaningfulProgressCycle: 2,
        lastCheckpointAt: "2026-04-12T00:10:00.000Z",
        lastSignals: {
          cycle: 2,
          outcome: "accepted",
          changedFileCount: 3,
          diffLineCount: 41,
          meaningfulProgress: true,
          insufficientEvidence: false,
          agentTieBreakerUsed: false,
          reasons: ["Generated the latest holdout report."],
          newArtifacts: ["reports/holdout-002.json"],
          repeatedDiff: false,
        },
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 3,
        requiresUserConfirmation: false,
        checkpointRunId: "run-002",
        checkpointDecisionId: "decision-002",
      },
    });
    const repository: ResearchSessionRepository = {
      saveSession: async () => {
        throw new Error("continueSession should not rewrite an already-running checkpoint");
      },
      loadSession: async (sessionId) => {
        if (sessionId !== runningSession.sessionId) {
          return null;
        }

        return runningSession;
      },
      querySessions: async () => [runningSession],
    };
    let classifyCalls = 0;
    const service = new ResearchSessionOrchestratorService({
      createRepository: () => repository,
      recoveryService: {
        classifySession: async () => {
          classifyCalls += 1;
          throw new Error("running session fallback should not call classifySession");
        },
      },
      lifecycleService: {
        resolveCycleSession: async () => ({
          decision: "replace",
          session: runningSession,
          lifecycle: null,
          recovery: {
            classification: "inspect_only",
            resumeAllowed: false,
            reason: "running session is missing Codex lifecycle evidence",
            runtime: {
              state: "missing",
              processAlive: false,
              stale: false,
            },
          },
          codexSessionReference: null,
          reason: "running session is missing Codex lifecycle evidence",
          replace: {
            runtimeState: "missing",
            completedCycles: 2,
            resumeFromCycle: 3,
            resumable: false,
            reason: "running session is missing Codex lifecycle evidence",
            attachabilityMode: "inspect",
          },
        }),
      },
    });

    const continued = await service.continueSession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(classifyCalls).toBe(0);
    expect(continued).toMatchObject({
      step: "session_resumed",
      session: runningSession,
      cycle: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-002"],
        lastSignals: runningSession.progress.lastSignals,
        sessionResolution: {
          decision: "replace",
          replace: {
            runtimeState: "missing",
            completedCycles: 2,
            resumeFromCycle: 3,
            resumable: false,
            reason: "running session is missing Codex lifecycle evidence",
            attachabilityMode: "inspect",
          },
          reason: "running session is missing Codex lifecycle evidence",
        },
      },
    });
  });

  it("allows running sessions with live but non-reusable Codex attachments to fall back to replacement", async () => {
    const runningSession = makeSession({
      progress: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-002"],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
        lastMeaningfulProgressCycle: 2,
        lastCheckpointAt: "2026-04-12T00:10:00.000Z",
        lastSignals: {
          cycle: 2,
          outcome: "accepted",
          changedFileCount: 3,
          diffLineCount: 41,
          meaningfulProgress: true,
          insufficientEvidence: false,
          agentTieBreakerUsed: false,
          reasons: ["Generated the latest holdout report."],
          newArtifacts: ["reports/holdout-002.json"],
          repeatedDiff: false,
        },
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 3,
        requiresUserConfirmation: false,
        checkpointRunId: "run-002",
        checkpointDecisionId: "decision-002",
      },
    });
    const repository: ResearchSessionRepository = {
      saveSession: async () => {
        throw new Error("continueSession should not rewrite an already-running checkpoint");
      },
      loadSession: async (sessionId) => {
        if (sessionId !== runningSession.sessionId) {
          return null;
        }

        return runningSession;
      },
      querySessions: async () => [runningSession],
    };
    const service = new ResearchSessionOrchestratorService({
      createRepository: () => repository,
      recoveryService: {
        classifySession: async () => {
          throw new Error("running session fallback should not call classifySession");
        },
      },
      lifecycleService: {
        resolveCycleSession: async () => ({
          decision: "replace",
          session: runningSession,
          lifecycle: {
            sessionId: "session-001",
            workingDirectory: tempRoot,
            goal: runningSession.goal,
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
              codexSessionId: "codex-session-001",
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
              status: "released",
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
          },
          recovery: {
            classification: "inspect_only",
            resumeAllowed: false,
            reason: "Codex CLI process is live, but attachmentState.status is released instead of bound",
            runtime: {
              state: "active",
              processAlive: true,
              stale: false,
              pid: 3131,
              phase: "running",
            },
          },
          codexSessionReference: {
            codexSessionId: "codex-session-001",
            lifecyclePath: join(tempRoot, ".ralph", "sessions", "session-001", "codex-session.json"),
          },
          reason: "Codex CLI process is live, but attachmentState.status is released instead of bound",
          replace: {
            runtimeState: "active",
            completedCycles: 2,
            resumeFromCycle: 3,
            resumable: false,
            reason: "Codex CLI still appears to be running for this session",
            attachabilityMode: "inspect",
            phase: "running",
            attachmentStatus: "released",
          },
        }),
      },
    });

    const continued = await service.continueSession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(continued).toMatchObject({
      step: "session_resumed",
      session: runningSession,
      cycle: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-002"],
        lastSignals: runningSession.progress.lastSignals,
        sessionResolution: {
          decision: "replace",
          replace: {
            runtimeState: "active",
            completedCycles: 2,
            resumeFromCycle: 3,
            resumable: false,
            reason: "Codex CLI still appears to be running for this session",
            attachabilityMode: "inspect",
            phase: "running",
            attachmentStatus: "released",
          },
          reason: "Codex CLI process is live, but attachmentState.status is released instead of bound",
        },
      },
    });
  });

  it("allows live running sessions to continue when the Codex lifecycle can be reattached", async () => {
    const runningSession = makeSession({
      progress: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-002"],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
        lastMeaningfulProgressCycle: 2,
        lastCheckpointAt: "2026-04-12T00:10:00.000Z",
        lastSignals: {
          cycle: 2,
          outcome: "accepted",
          changedFileCount: 3,
          diffLineCount: 41,
          meaningfulProgress: true,
          insufficientEvidence: false,
          agentTieBreakerUsed: false,
          reasons: ["Generated the latest holdout report."],
          newArtifacts: ["reports/holdout-002.json"],
          repeatedDiff: false,
        },
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 3,
        requiresUserConfirmation: false,
        checkpointRunId: "run-002",
        checkpointDecisionId: "decision-002",
      },
    });
    const repository: ResearchSessionRepository = {
      saveSession: async () => {
        throw new Error("continueSession should not rewrite an already-running checkpoint");
      },
      loadSession: async (sessionId) => {
        if (sessionId !== runningSession.sessionId) {
          return null;
        }

        return runningSession;
      },
      querySessions: async () => [runningSession],
    };
    const service = new ResearchSessionOrchestratorService({
      createRepository: () => repository,
      lifecycleService: {
        resolveCycleSession: async () => ({
          decision: "reuse",
          session: runningSession,
          lifecycle: {
            sessionId: "session-001",
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
            codexSessionId: "session-001",
            lifecyclePath: join(tempRoot, ".ralph", "sessions", "session-001", "codex-session.json"),
          },
          reason: "Codex CLI session is still live and bound to the persisted working-directory attachment",
          reuse: {
            researchSessionId: "session-001",
            codexSessionId: "session-001",
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
        }),
      },
    });

    const continued = await service.continueSession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(continued).toMatchObject({
      step: "session_resumed",
      session: {
        sessionId: "session-001",
        status: "running",
      },
      cycle: {
        sessionResolution: {
          decision: "reuse",
          reuse: {
            researchSessionId: "session-001",
            pid: 3131,
          },
        },
      },
    });
  });

  it("rejects continueSession when the halted checkpoint is not marked resumable", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(
      makeSession({
        status: "halted",
        stopCondition: {
          type: "operator_stop",
          note: "Cycle 2 requires manual review before continuing.",
        },
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-002"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 2,
          lastCheckpointAt: "2026-04-12T00:10:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "needs_human",
            changedFileCount: 2,
            diffLineCount: 18,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["Produced a manual review bundle."],
            newArtifacts: ["reports/manual-review-002.json"],
            repeatedDiff: false,
          },
        },
        resume: {
          resumable: false,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: true,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
        },
      }),
    );
    const service = new ResearchSessionOrchestratorService({
      recoveryService: {
        classifySession: async () => ({
          classification: "resumable",
          resumeAllowed: true,
          reason: "manual review cleared; continue from completed cycle boundary 3",
          runtime: {
            state: "exited",
            processAlive: false,
            stale: false,
            phase: "clean_exit",
          },
        }),
      },
    });

    await expect(
      service.continueSession({
        repoRoot: tempRoot,
        sessionId: "session-001",
      }),
    ).rejects.toThrow(
      "Session session-001 cannot resume from status halted because its checkpoint is not marked resumable",
    );
  });

  it("resumes a persisted stale running session from disk without replaying completed cycles", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(
      makeSession({
        status: "running",
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
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: false,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
        },
      }),
    );

    let runCalls = 0;
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:12:00.000Z"),
      recoveryService: {
        classifySession: async () => ({
          classification: "resumable",
          resumeAllowed: true,
          reason: "Codex CLI is no longer live; resume from completed cycle boundary 3",
          runtime: {
            state: "stale",
            processAlive: false,
            stale: true,
            phase: "running",
          },
        }),
      },
      runCycleService: {
        run: async () => {
          runCalls += 1;
          return {
            status: "accepted",
            manifestPath: join(tempRoot, "ralph.yaml"),
            lockPath: join(tempRoot, ".ralph", "lock"),
            runResult: {
              status: "accepted",
              run: makeRunRecord({
                runId: "run-003",
                cycle: 3,
                status: "accepted",
                proposal: {
                  proposerType: "codex_cli",
                  summary: "Advance from the persisted cycle 2 checkpoint.",
                  diffLines: 27,
                  filesChanged: 3,
                  changedPaths: [
                    "reports/cycle-003.json",
                    "reports/summary-003.json",
                    "docs/findings.md",
                  ],
                  withinBudget: true,
                  operators: [],
                },
                artifacts: [
                  {
                    id: "cycle-003-report",
                    path: "reports/cycle-003.json",
                  },
                ],
              }),
              decision: {
                decisionId: "decision-003",
                runId: "run-003",
                outcome: "accepted",
                actorType: "system",
                policyType: "ratchet",
                delta: 0.09,
                reason: "future holdout score improved again",
                createdAt: "2026-04-12T00:11:00.000Z",
                frontierChanged: true,
                beforeFrontierIds: ["frontier-001", "frontier-002"],
                afterFrontierIds: ["frontier-001", "frontier-002", "frontier-003"],
                auditRequired: false,
              },
              frontier: [
                {
                  frontierId: "frontier-001",
                  runId: "run-001",
                  candidateId: "candidate-000",
                  acceptedAt: "2026-04-12T00:01:00.000Z",
                  metrics: {},
                  artifacts: [],
                },
                {
                  frontierId: "frontier-002",
                  runId: "run-002",
                  candidateId: "candidate-001",
                  acceptedAt: "2026-04-12T00:10:00.000Z",
                  metrics: {},
                  artifacts: [],
                },
                {
                  frontierId: "frontier-003",
                  runId: "run-003",
                  candidateId: "candidate-002",
                  acceptedAt: "2026-04-12T00:11:00.000Z",
                  metrics: {},
                  artifacts: [],
                },
              ],
              auditQueue: [],
            },
          };
        },
      },
    });

    const continued = await service.continueSession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(continued).toMatchObject({
      step: "session_resumed",
      session: makeSession({
        status: "running",
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
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: false,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
        },
      }),
      cycle: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-001", "frontier-002"],
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
        sessionResolution: {
          decision: "replace",
          replace: {
            runtimeState: "missing",
            resumable: false,
            attachabilityMode: "inspect",
          },
        },
      },
    });

    const result = await service.runCycles({
      repoRoot: tempRoot,
      sessionId: "session-001",
      maxCycles: 1,
    });

    expect(runCalls).toBe(1);
    expect(result).toMatchObject({
      cyclesExecuted: 1,
      steps: [
        {
          step: "cycle_checkpointed",
          session: {
            status: "running",
            progress: {
              completedCycles: 3,
              nextCycle: 4,
              latestRunId: "run-003",
              latestDecisionId: "decision-003",
              latestFrontierIds: ["frontier-001", "frontier-002", "frontier-003"],
            },
            resume: {
              resumeFromCycle: 4,
              checkpointRunId: "run-003",
              checkpointDecisionId: "decision-003",
            },
          },
          cycle: {
            run: {
              runId: "run-003",
              cycle: 3,
            },
          },
        },
      ],
      session: {
        status: "running",
        progress: {
          completedCycles: 3,
          nextCycle: 4,
          latestRunId: "run-003",
        },
      },
    });

    const persisted = await repository.loadSession("session-001");
    expect(persisted).toMatchObject({
      status: "running",
      progress: {
        completedCycles: 3,
        nextCycle: 4,
        latestRunId: "run-003",
        latestDecisionId: "decision-003",
        latestFrontierIds: ["frontier-001", "frontier-002", "frontier-003"],
        lastMeaningfulProgressCycle: 3,
      },
      resume: {
        resumeFromCycle: 4,
        checkpointRunId: "run-003",
        checkpointDecisionId: "decision-003",
        requiresUserConfirmation: false,
      },
    });
  });

  it("resumes a persisted interrupted session from disk without losing the prior checkpoint state", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(
      makeSession({
        status: "awaiting_resume",
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-001", "frontier-002"],
          repeatedFailureStreak: 1,
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
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: true,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          interruptionDetectedAt: "2026-04-12T00:11:00.000Z",
          interruptedDuringCycle: 3,
          note: "Codex CLI exited cleanly before cycle 3 completed.",
        },
      }),
    );

    let runCalls = 0;
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:12:00.000Z"),
      recoveryService: {
        classifySession: async () => ({
          classification: "resumable",
          resumeAllowed: true,
          reason: "Codex CLI exited cleanly before cycle 3 completed",
          runtime: {
            state: "exited",
            processAlive: false,
            stale: false,
            phase: "clean_exit",
          },
        }),
      },
      runCycleService: {
        run: async () => {
          runCalls += 1;
          return {
            status: "accepted",
            manifestPath: join(tempRoot, "ralph.yaml"),
            lockPath: join(tempRoot, ".ralph", "lock"),
            runResult: {
              status: "accepted",
              run: makeRunRecord({
                runId: "run-003",
                cycle: 3,
                status: "accepted",
                proposal: {
                  proposerType: "codex_cli",
                  summary: "Resume from the persisted interruption boundary.",
                  diffLines: 29,
                  filesChanged: 4,
                  changedPaths: [
                    "reports/cycle-003.json",
                    "reports/summary-003.json",
                    "docs/findings.md",
                    "docs/holdout.md",
                  ],
                  withinBudget: true,
                  operators: [],
                },
                artifacts: [
                  {
                    id: "cycle-003-report",
                    path: "reports/cycle-003.json",
                  },
                  {
                    id: "cycle-003-summary",
                    path: "reports/summary-003.json",
                  },
                ],
              }),
              decision: {
                decisionId: "decision-003",
                runId: "run-003",
                outcome: "accepted",
                actorType: "system",
                policyType: "ratchet",
                delta: 0.1,
                reason: "future holdout score improved after resume",
                createdAt: "2026-04-12T00:11:00.000Z",
                frontierChanged: true,
                beforeFrontierIds: ["frontier-001", "frontier-002"],
                afterFrontierIds: ["frontier-001", "frontier-002", "frontier-003"],
                auditRequired: false,
              },
              frontier: [
                {
                  frontierId: "frontier-001",
                  runId: "run-001",
                  candidateId: "candidate-000",
                  acceptedAt: "2026-04-12T00:01:00.000Z",
                  metrics: {},
                  artifacts: [],
                },
                {
                  frontierId: "frontier-002",
                  runId: "run-002",
                  candidateId: "candidate-001",
                  acceptedAt: "2026-04-12T00:10:00.000Z",
                  metrics: {},
                  artifacts: [],
                },
                {
                  frontierId: "frontier-003",
                  runId: "run-003",
                  candidateId: "candidate-002",
                  acceptedAt: "2026-04-12T00:11:00.000Z",
                  metrics: {},
                  artifacts: [],
                },
              ],
              auditQueue: [],
            },
          };
        },
      },
    });

    const resumed = await service.resumeSession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(resumed).toMatchObject({
      step: "session_resumed",
      session: {
        status: "running",
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-001", "frontier-002"],
          repeatedFailureStreak: 1,
        },
        resume: {
          resumeFromCycle: 3,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          requiresUserConfirmation: false,
        },
      },
    });
    expect(resumed.session.resume.interruptionDetectedAt).toBeUndefined();
    expect(resumed.session.resume.interruptedDuringCycle).toBeUndefined();
    expect(resumed.session.resume.note).toBeUndefined();

    const persistedAfterResume = await repository.loadSession("session-001");
    expect(persistedAfterResume).toMatchObject({
      status: "running",
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
        requiresUserConfirmation: false,
      },
    });
    expect(persistedAfterResume?.resume.interruptionDetectedAt).toBeUndefined();
    expect(persistedAfterResume?.resume.interruptedDuringCycle).toBeUndefined();
    expect(persistedAfterResume?.resume.note).toBeUndefined();

    const result = await service.runCycles({
      repoRoot: tempRoot,
      sessionId: "session-001",
      maxCycles: 1,
    });

    expect(runCalls).toBe(1);
    expect(result).toMatchObject({
      cyclesExecuted: 1,
      steps: [
        {
          step: "cycle_checkpointed",
          session: {
            status: "running",
            progress: {
              completedCycles: 3,
              nextCycle: 4,
              latestRunId: "run-003",
              latestDecisionId: "decision-003",
              latestFrontierIds: ["frontier-001", "frontier-002", "frontier-003"],
              repeatedFailureStreak: 0,
            },
            resume: {
              resumeFromCycle: 4,
              checkpointRunId: "run-003",
              checkpointDecisionId: "decision-003",
            },
          },
          cycle: {
            run: {
              runId: "run-003",
              cycle: 3,
            },
          },
        },
      ],
      session: {
        status: "running",
        progress: {
          completedCycles: 3,
          nextCycle: 4,
        },
      },
    });

    const persisted = await repository.loadSession("session-001");
    expect(persisted).toMatchObject({
      status: "running",
      progress: {
        completedCycles: 3,
        nextCycle: 4,
        latestRunId: "run-003",
        latestDecisionId: "decision-003",
        latestFrontierIds: ["frontier-001", "frontier-002", "frontier-003"],
        repeatedFailureStreak: 0,
        lastMeaningfulProgressCycle: 3,
      },
      resume: {
        resumeFromCycle: 4,
        checkpointRunId: "run-003",
        checkpointDecisionId: "decision-003",
        requiresUserConfirmation: false,
      },
    });
  });

  it("wires the existing RunCycleService into executeCycle and exposes the current cycle snapshot", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(makeSession());
    const events: string[] = [];
    const runInputs: Array<Record<string, unknown>> = [];
    const run = makeRunRecord({
      runId: "run-002",
      cycle: 1,
      status: "accepted",
    });
    const service = new ResearchSessionOrchestratorService({
      lifecycleService: {
        resolveCycleSession: async () => {
          events.push("resolve");
          return {
            decision: "replace",
            session: makeSession(),
            lifecycle: null,
            recovery: {
              classification: "resumable",
              resumeAllowed: true,
              reason: "Codex CLI is no longer live; replace the TTY session at cycle boundary 1",
              runtime: {
                state: "stale",
                processAlive: false,
                stale: true,
                phase: "running",
              },
            },
            codexSessionReference: {
              codexSessionId: "codex-session-001",
              lifecyclePath: join(tempRoot, ".ralph", "sessions", "session-001", "codex-session.json"),
            },
            reason: "Codex CLI is no longer live; replace the TTY session at cycle boundary 1",
            replace: {
              runtimeState: "stale",
              completedCycles: 0,
              resumeFromCycle: 1,
              resumable: true,
              reason: "Codex CLI is no longer live; replace the TTY session at cycle boundary 1",
              attachabilityMode: "resume",
            },
          };
        },
      },
      runCycleService: {
        run: async (input) => {
          events.push("run");
          runInputs.push(input as Record<string, unknown>);
          return {
            status: "accepted",
            manifestPath: join(tempRoot, "ralph.yaml"),
            lockPath: join(tempRoot, ".ralph", "lock"),
            runResult: {
              status: "accepted",
              run,
              decision: {
                decisionId: "decision-002",
                runId: "run-002",
                outcome: "accepted",
                actorType: "system",
                policyType: "ratchet",
                reason: "metric improved",
                createdAt: "2026-04-12T00:02:00.000Z",
                frontierChanged: true,
                beforeFrontierIds: [],
                afterFrontierIds: ["frontier-002"],
                auditRequired: false,
              },
              frontier: [
                {
                  frontierId: "frontier-002",
                  runId: "run-002",
                  candidateId: "candidate-001",
                  acceptedAt: "2026-04-12T00:02:00.000Z",
                  metrics: {},
                  artifacts: [],
                },
              ],
              auditQueue: [],
            },
          };
        },
      },
    });

    const executed = await service.executeCycle({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(executed).toMatchObject({
      step: "cycle_executed",
      session: {
        sessionId: "session-001",
        status: "running",
        progress: {
          completedCycles: 0,
          nextCycle: 1,
        },
      },
      cycle: {
        completedCycles: 0,
        nextCycle: 1,
        latestFrontierIds: ["frontier-002"],
        sessionResolution: {
          decision: "replace",
          reason: "Codex CLI is no longer live; replace the TTY session at cycle boundary 1",
          replace: {
            runtimeState: "stale",
            resumeFromCycle: 1,
            attachabilityMode: "resume",
          },
        },
        run: {
          runId: "run-002",
          cycle: 1,
        },
        decision: {
          decisionId: "decision-002",
          runId: "run-002",
        },
        runResult: {
          status: "accepted",
        },
      },
    });
    expect(events).toEqual(["resolve", "run"]);
    expect(runInputs).toEqual([
      expect.objectContaining({
        repoRoot: expect.stringContaining("ralph-research-session-orchestrator-"),
        codexSession: {
          researchSessionId: "session-001",
          existingCodexSessionId: "codex-session-001",
        },
      }),
    ]);
  });

  it("steps exactly one cycle and checkpoints the resulting run, decision, and frontier back into the session", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(makeSession());

    let runCalls = 0;
    const run = makeRunRecord({
      runId: "run-002",
      cycle: 1,
      status: "accepted",
      proposal: {
        proposerType: "codex_cli",
        summary: "Generate a fresh holdout evaluation bundle.",
        diffLines: 21,
        filesChanged: 3,
        changedPaths: [
          "reports/future-holdout.json",
          "reports/feature-ranking.json",
          "docs/findings.md",
        ],
        withinBudget: true,
        operators: [],
      },
      artifacts: [
        {
          id: "future-holdout-report",
          path: "reports/future-holdout.json",
        },
      ],
    });
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:03:00.000Z"),
      runCycleService: {
        run: async () => {
          runCalls += 1;
          return {
            status: "accepted",
            manifestPath: join(tempRoot, "ralph.yaml"),
            lockPath: join(tempRoot, ".ralph", "lock"),
            runResult: {
              status: "accepted",
              run,
              decision: {
                decisionId: "decision-002",
                runId: "run-002",
                outcome: "accepted",
                actorType: "system",
                policyType: "ratchet",
                delta: 0.12,
                reason: "future holdout top-3 score improved",
                createdAt: "2026-04-12T00:02:00.000Z",
                frontierChanged: true,
                beforeFrontierIds: [],
                afterFrontierIds: ["frontier-002"],
                auditRequired: false,
              },
              frontier: [
                {
                  frontierId: "frontier-002",
                  runId: "run-002",
                  candidateId: "candidate-001",
                  acceptedAt: "2026-04-12T00:02:00.000Z",
                  metrics: {},
                  artifacts: [],
                },
              ],
              auditQueue: [],
            },
          };
        },
      },
    });

    const stepped = await service.step({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(runCalls).toBe(1);
    expect(stepped).toMatchObject({
      step: "cycle_checkpointed",
      session: {
        sessionId: "session-001",
        status: "running",
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-002"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 1,
          lastCheckpointAt: "2026-04-12T00:03:00.000Z",
          lastSignals: {
            cycle: 1,
            outcome: "accepted",
            changedFileCount: 3,
            diffLineCount: 21,
            repeatedDiff: false,
            verificationDelta: 0.12,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            newArtifacts: ["reports/future-holdout.json"],
          },
        },
        resume: {
          resumeFromCycle: 2,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          requiresUserConfirmation: false,
        },
      },
      cycle: {
        completedCycles: 1,
        nextCycle: 2,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-002"],
        run: {
          runId: "run-002",
          cycle: 1,
        },
        decision: {
          decisionId: "decision-002",
          runId: "run-002",
        },
      },
    });
    expect(stepped.session.progress.lastSignals?.reasons).toEqual([
      "Changed 3 tracked files.",
      "Recorded 21 diff lines.",
      "Produced 1 verification artifact.",
      "Updated the persisted frontier checkpoint.",
    ]);

    const persisted = await repository.loadSession("session-001");
    expect(persisted).not.toBeNull();
    expect(persisted?.progress.completedCycles).toBe(1);
    expect(persisted?.progress.nextCycle).toBe(2);
    expect(persisted?.progress.latestRunId).toBe("run-002");
    expect(persisted?.resume.checkpointRunId).toBe("run-002");
  });

  it("advances persisted cycle counters, session metadata, and running status after each completed cycle", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(makeSession());

    const timestamps = [
      "2026-04-12T00:03:00.000Z",
      "2026-04-12T00:04:00.000Z",
    ];
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date(timestamps.shift() ?? "2026-04-12T00:05:00.000Z"),
    });

    const firstCheckpoint = await service.recordCompletedCycle({
      repoRoot: tempRoot,
      sessionId: "session-001",
      run: makeRunRecord({
        runId: "run-002",
        cycle: 1,
        status: "accepted",
      }),
      decision: {
        decisionId: "decision-002",
        runId: "run-002",
        outcome: "accepted",
        actorType: "system",
        policyType: "ratchet",
        delta: 0.08,
        reason: "future holdout score improved",
        createdAt: "2026-04-12T00:02:00.000Z",
        frontierChanged: true,
        beforeFrontierIds: [],
        afterFrontierIds: ["frontier-002"],
        auditRequired: false,
      },
      frontierIds: ["frontier-002"],
      signal: {
        outcome: "accepted",
        changedFileCount: 2,
        diffLineCount: 19,
        repeatedDiff: false,
        meaningfulProgress: true,
        insufficientEvidence: false,
        agentTieBreakerUsed: false,
        verificationDelta: 0.08,
        reasons: ["Created the first completed-cycle checkpoint bundle."],
        newArtifacts: ["reports/cycle-001.json"],
      },
    });

    expect(firstCheckpoint).toMatchObject({
      step: "cycle_checkpointed",
      session: {
        status: "running",
        stopCondition: {
          type: "none",
        },
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-002"],
          lastCheckpointAt: "2026-04-12T00:03:00.000Z",
          lastSignals: {
            cycle: 1,
            outcome: "accepted",
          },
        },
        resume: {
          resumeFromCycle: 2,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          requiresUserConfirmation: false,
        },
      },
    });

    const persistedAfterFirst = await repository.loadSession("session-001");
    expect(persistedAfterFirst).not.toBeNull();
    expect(persistedAfterFirst).toMatchObject({
      sessionId: "session-001",
      goal: "Reach 70% future holdout top-3 prediction success.",
      workingDirectory: tempRoot,
      status: "running",
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:03:00.000Z",
      stopCondition: {
        type: "none",
      },
      progress: {
        completedCycles: 1,
        nextCycle: 2,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-002"],
        lastCheckpointAt: "2026-04-12T00:03:00.000Z",
        lastSignals: {
          cycle: 1,
          outcome: "accepted",
        },
      },
      resume: {
        resumeFromCycle: 2,
        checkpointRunId: "run-002",
        checkpointDecisionId: "decision-002",
        requiresUserConfirmation: false,
      },
    });
    expect(persistedAfterFirst?.endedAt).toBeUndefined();

    const secondCheckpoint = await service.recordCompletedCycle({
      repoRoot: tempRoot,
      sessionId: "session-001",
      run: makeRunRecord({
        runId: "run-003",
        cycle: 2,
        status: "accepted",
      }),
      decision: {
        decisionId: "decision-003",
        runId: "run-003",
        outcome: "accepted",
        actorType: "system",
        policyType: "ratchet",
        delta: 0.11,
        reason: "future holdout score improved again",
        createdAt: "2026-04-12T00:03:30.000Z",
        frontierChanged: true,
        beforeFrontierIds: ["frontier-002"],
        afterFrontierIds: ["frontier-002", "frontier-003"],
        auditRequired: false,
      },
      frontierIds: ["frontier-002", "frontier-003"],
      signal: {
        outcome: "accepted",
        changedFileCount: 3,
        diffLineCount: 24,
        repeatedDiff: false,
        meaningfulProgress: true,
        insufficientEvidence: false,
        agentTieBreakerUsed: false,
        verificationDelta: 0.11,
        reasons: ["Created the second completed-cycle checkpoint bundle."],
        newArtifacts: ["reports/cycle-002.json"],
      },
    });

    expect(secondCheckpoint).toMatchObject({
      step: "cycle_checkpointed",
      session: {
        status: "running",
        stopCondition: {
          type: "none",
        },
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-003",
          latestDecisionId: "decision-003",
          latestFrontierIds: ["frontier-002", "frontier-003"],
          lastMeaningfulProgressCycle: 2,
          lastCheckpointAt: "2026-04-12T00:04:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
          },
        },
        resume: {
          resumeFromCycle: 3,
          checkpointRunId: "run-003",
          checkpointDecisionId: "decision-003",
          requiresUserConfirmation: false,
        },
      },
    });

    const persistedAfterSecond = await repository.loadSession("session-001");
    expect(persistedAfterSecond).not.toBeNull();
    expect(persistedAfterSecond).toMatchObject({
      sessionId: "session-001",
      goal: "Reach 70% future holdout top-3 prediction success.",
      workingDirectory: tempRoot,
      status: "running",
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:04:00.000Z",
      stopCondition: {
        type: "none",
      },
      progress: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-003",
        latestDecisionId: "decision-003",
        latestFrontierIds: ["frontier-002", "frontier-003"],
        lastMeaningfulProgressCycle: 2,
        lastCheckpointAt: "2026-04-12T00:04:00.000Z",
        lastSignals: {
          cycle: 2,
          outcome: "accepted",
        },
      },
      resume: {
        resumeFromCycle: 3,
        checkpointRunId: "run-003",
        checkpointDecisionId: "decision-003",
        requiresUserConfirmation: false,
      },
    });
    expect(persistedAfterSecond?.endedAt).toBeUndefined();
  });

  it("stops scheduling further cycles once a completed cycle persists a stop-requested session", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(makeSession());

    let runCalls = 0;
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:04:00.000Z"),
      runCycleService: {
        run: async () => {
          runCalls += 1;
          return {
            status: "needs_human",
            manifestPath: join(tempRoot, "ralph.yaml"),
            lockPath: join(tempRoot, ".ralph", "lock"),
            runResult: {
              status: "needs_human",
              run: makeRunRecord({
                runId: "run-003",
                cycle: 1,
                status: "needs_human",
                artifacts: [
                  {
                    id: "manual-review-report",
                    path: "reports/manual-review-003.json",
                  },
                ],
                proposal: {
                  proposerType: "codex_cli",
                  summary: "Produce a candidate that still needs operator judgment.",
                  diffLines: 18,
                  filesChanged: 2,
                  changedPaths: [
                    "reports/manual-review-003.json",
                    "docs/review-notes.md",
                  ],
                  withinBudget: true,
                  operators: [],
                },
              }),
              decision: {
                decisionId: "decision-003",
                runId: "run-003",
                outcome: "needs_human",
                actorType: "system",
                policyType: "approval_gate",
                reason: "confidence stayed below the auto-accept threshold",
                createdAt: "2026-04-12T00:03:00.000Z",
                frontierChanged: false,
                beforeFrontierIds: [],
                afterFrontierIds: [],
                auditRequired: false,
              },
              frontier: [],
              auditQueue: [],
            },
          };
        },
      },
    });

    const result = await service.runCycles({
      repoRoot: tempRoot,
      sessionId: "session-001",
      maxCycles: 3,
    });

    expect(runCalls).toBe(1);
    expect(result).toMatchObject({
      cyclesExecuted: 1,
      steps: [
        {
          step: "session_halted",
          session: {
            status: "halted",
            stopCondition: {
              type: "operator_stop",
              note: "Cycle 1 requires manual review before continuing.",
            },
          },
        },
      ],
      session: {
        status: "halted",
        stopCondition: {
          type: "operator_stop",
          note: "Cycle 1 requires manual review before continuing.",
        },
      },
    });

    const persisted = await repository.loadSession("session-001");
    expect(persisted).toMatchObject({
      status: "halted",
      stopCondition: {
        type: "operator_stop",
        note: "Cycle 1 requires manual review before continuing.",
      },
      progress: {
        completedCycles: 1,
        nextCycle: 2,
        latestRunId: "run-003",
        latestDecisionId: "decision-003",
        latestFrontierIds: [],
        lastCheckpointAt: "2026-04-12T00:04:00.000Z",
        lastSignals: {
          cycle: 1,
          outcome: "needs_human",
          changedFileCount: 2,
          diffLineCount: 18,
          meaningfulProgress: true,
          insufficientEvidence: false,
          newArtifacts: ["reports/manual-review-003.json"],
        },
      },
      resume: {
        resumable: true,
        resumeFromCycle: 2,
        checkpointRunId: "run-003",
        checkpointDecisionId: "decision-003",
        requiresUserConfirmation: true,
      },
    });
    expect(persisted?.endedAt).toBeUndefined();
  });

  it("re-reads persisted session state before scheduling another cycle and stops on terminal status", async () => {
    let storedSession = makeSession();
    let promoteAfterCheckpoint = false;
    let runCalls = 0;

    const repository: ResearchSessionRepository = {
      saveSession: async (record) => {
        storedSession = record;
        if (record.status === "running" && record.progress.completedCycles === 1) {
          promoteAfterCheckpoint = true;
        }
      },
      loadSession: async (sessionId) => {
        if (sessionId !== storedSession.sessionId) {
          return null;
        }

        if (promoteAfterCheckpoint) {
          promoteAfterCheckpoint = false;
          storedSession = researchSessionRecordSchema.parse({
            ...storedSession,
            status: "goal_achieved",
            stopCondition: {
              type: "goal_achieved",
              summary: "Future holdout top-3 success reached 72%.",
              achievedAtCycle: storedSession.progress.completedCycles,
            },
            resume: {
              ...storedSession.resume,
              resumable: false,
              requiresUserConfirmation: false,
            },
            evidenceBundlePath: ".ralph/sessions/session-001/evidence",
            updatedAt: "2026-04-12T00:03:00.000Z",
            endedAt: "2026-04-12T00:03:00.000Z",
          });
        }

        return storedSession;
      },
      querySessions: async () => [storedSession],
    };

    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:02:00.000Z"),
      createRepository: () => repository,
      runCycleService: {
        run: async () => {
          runCalls += 1;
          return {
            status: "accepted",
            manifestPath: join(tempRoot, "ralph.yaml"),
            lockPath: join(tempRoot, ".ralph", "lock"),
            runResult: {
              status: "accepted",
              run: makeRunRecord({
                runId: "run-002",
                cycle: 1,
                status: "accepted",
              }),
              decision: {
                decisionId: "decision-002",
                runId: "run-002",
                outcome: "accepted",
                actorType: "system",
                policyType: "ratchet",
                reason: "metric improved",
                createdAt: "2026-04-12T00:02:00.000Z",
                frontierChanged: true,
                beforeFrontierIds: [],
                afterFrontierIds: ["frontier-002"],
                auditRequired: false,
              },
              frontier: [
                {
                  frontierId: "frontier-002",
                  runId: "run-002",
                  candidateId: "candidate-001",
                  acceptedAt: "2026-04-12T00:02:00.000Z",
                  metrics: {},
                  artifacts: [],
                },
              ],
              auditQueue: [],
            },
          };
        },
      },
    });

    const result = await service.runCycles({
      repoRoot: tempRoot,
      sessionId: "session-001",
      maxCycles: 3,
    });

    expect(runCalls).toBe(1);
    expect(result).toMatchObject({
      cyclesExecuted: 1,
      steps: [
        {
          step: "cycle_checkpointed",
          session: {
            status: "running",
            progress: {
              completedCycles: 1,
              nextCycle: 2,
            },
          },
        },
      ],
      session: {
        status: "goal_achieved",
        stopCondition: {
          type: "goal_achieved",
          summary: "Future holdout top-3 success reached 72%.",
          achievedAtCycle: 1,
        },
      },
    });
  });

  it("re-reads persisted session state before scheduling another cycle and stops on terminal-triggered interruption", async () => {
    let storedSession = makeSession();
    let interruptAfterCheckpoint = false;
    let runCalls = 0;

    const repository: ResearchSessionRepository = {
      saveSession: async (record) => {
        storedSession = record;
        if (record.status === "running" && record.progress.completedCycles === 1) {
          interruptAfterCheckpoint = true;
        }
      },
      loadSession: async (sessionId) => {
        if (sessionId !== storedSession.sessionId) {
          return null;
        }

        if (interruptAfterCheckpoint) {
          interruptAfterCheckpoint = false;
          storedSession = researchSessionRecordSchema.parse({
            ...storedSession,
            status: "awaiting_resume",
            stopCondition: {
              type: "none",
            },
            resume: {
              ...storedSession.resume,
              resumable: true,
              requiresUserConfirmation: true,
              interruptionDetectedAt: "2026-04-12T00:03:00.000Z",
              interruptedDuringCycle: storedSession.progress.nextCycle,
              note: "Operator stopped the terminal session after cycle 1 checkpoint.",
            },
            updatedAt: "2026-04-12T00:03:00.000Z",
          });
        }

        return storedSession;
      },
      querySessions: async () => [storedSession],
    };

    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:02:00.000Z"),
      createRepository: () => repository,
      runCycleService: {
        run: async () => {
          runCalls += 1;
          return {
            status: "accepted",
            manifestPath: join(tempRoot, "ralph.yaml"),
            lockPath: join(tempRoot, ".ralph", "lock"),
            runResult: {
              status: "accepted",
              run: makeRunRecord({
                runId: "run-002",
                cycle: 1,
                status: "accepted",
                proposal: {
                  proposerType: "codex_cli",
                  summary: "Checkpoint the first future holdout report.",
                  diffLines: 16,
                  filesChanged: 2,
                  changedPaths: [
                    "reports/cycle-001.json",
                    "docs/findings.md",
                  ],
                  withinBudget: true,
                  operators: [],
                },
                artifacts: [
                  {
                    id: "cycle-001-report",
                    path: "reports/cycle-001.json",
                  },
                ],
              }),
              decision: {
                decisionId: "decision-002",
                runId: "run-002",
                outcome: "accepted",
                actorType: "system",
                policyType: "ratchet",
                reason: "metric improved",
                createdAt: "2026-04-12T00:02:00.000Z",
                frontierChanged: true,
                beforeFrontierIds: [],
                afterFrontierIds: ["frontier-002"],
                auditRequired: false,
              },
              frontier: [
                {
                  frontierId: "frontier-002",
                  runId: "run-002",
                  candidateId: "candidate-001",
                  acceptedAt: "2026-04-12T00:02:00.000Z",
                  metrics: {},
                  artifacts: [],
                },
              ],
              auditQueue: [],
            },
          };
        },
      },
    });

    const result = await service.runCycles({
      repoRoot: tempRoot,
      sessionId: "session-001",
      maxCycles: 3,
    });

    expect(runCalls).toBe(1);
    expect(result).toMatchObject({
      cyclesExecuted: 1,
      steps: [
        {
          step: "cycle_checkpointed",
          session: {
            status: "running",
            progress: {
              completedCycles: 1,
              nextCycle: 2,
            },
          },
        },
      ],
      session: {
        status: "awaiting_resume",
        stopCondition: {
          type: "none",
        },
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-002"],
          lastCheckpointAt: "2026-04-12T00:02:00.000Z",
          lastSignals: {
            cycle: 1,
            outcome: "accepted",
            changedFileCount: 2,
            diffLineCount: 16,
            meaningfulProgress: true,
            insufficientEvidence: false,
            newArtifacts: ["reports/cycle-001.json"],
          },
        },
        resume: {
          resumable: true,
          resumeFromCycle: 2,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          requiresUserConfirmation: true,
          interruptionDetectedAt: "2026-04-12T00:03:00.000Z",
          interruptedDuringCycle: 2,
          note: "Operator stopped the terminal session after cycle 1 checkpoint.",
        },
      },
    });

    const persisted = await repository.loadSession("session-001");
    expect(persisted).toMatchObject({
      status: "awaiting_resume",
      stopCondition: {
        type: "none",
      },
      progress: {
        completedCycles: 1,
        nextCycle: 2,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-002"],
        lastCheckpointAt: "2026-04-12T00:02:00.000Z",
      },
      resume: {
        resumable: true,
        resumeFromCycle: 2,
        checkpointRunId: "run-002",
        checkpointDecisionId: "decision-002",
        requiresUserConfirmation: true,
        interruptedDuringCycle: 2,
      },
    });
    expect(persisted?.endedAt).toBeUndefined();
  });

  it("resumes codex_cli runs from the persisted checkpoint after a terminal stop without replaying the interrupted cycle", async () => {
    let storedSession = makeSession();
    let interruptAfterFirstCheckpoint = false;
    let interruptionInjected = false;
    let runCalls = 0;

    const repository: ResearchSessionRepository = {
      saveSession: async (record) => {
        storedSession = record;
        if (!interruptionInjected && record.status === "running" && record.progress.completedCycles === 1) {
          interruptAfterFirstCheckpoint = true;
        }
      },
      loadSession: async (sessionId) => {
        if (sessionId !== storedSession.sessionId) {
          return null;
        }

        if (interruptAfterFirstCheckpoint) {
          interruptAfterFirstCheckpoint = false;
          interruptionInjected = true;
          storedSession = researchSessionRecordSchema.parse({
            ...storedSession,
            status: "awaiting_resume",
            stopCondition: {
              type: "none",
            },
            resume: {
              ...storedSession.resume,
              resumable: true,
              requiresUserConfirmation: true,
              interruptionDetectedAt: "2026-04-12T00:03:00.000Z",
              interruptedDuringCycle: storedSession.progress.nextCycle,
              note: "Operator stopped the terminal session after cycle 1 checkpoint.",
            },
            updatedAt: "2026-04-12T00:03:00.000Z",
          });
        }

        return storedSession;
      },
      querySessions: async () => [storedSession],
    };

    const timestamps = [
      "2026-04-12T00:02:00.000Z",
      "2026-04-12T00:04:00.000Z",
      "2026-04-12T00:05:00.000Z",
    ];
    let nowIndex = 0;
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date(timestamps[nowIndex++] ?? timestamps.at(-1)!),
      createRepository: () => repository,
      recoveryService: {
        classifySession: async () => ({
          classification: "resumable",
          resumeAllowed: true,
          reason: "Codex CLI exited cleanly before cycle 2 completed",
          runtime: {
            state: "exited",
            processAlive: false,
            stale: false,
            phase: "clean_exit",
          },
        }),
      },
      runCycleService: {
        run: async () => {
          runCalls += 1;
          if (runCalls === 1) {
            return {
              status: "accepted",
              manifestPath: join(tempRoot, "ralph.yaml"),
              lockPath: join(tempRoot, ".ralph", "lock"),
              runResult: {
                status: "accepted",
                run: makeRunRecord({
                  runId: "run-002",
                  cycle: 1,
                  status: "accepted",
                  proposal: {
                    proposerType: "codex_cli",
                    summary: "Checkpoint the first future holdout report.",
                    diffLines: 16,
                    filesChanged: 2,
                    changedPaths: [
                      "reports/cycle-001.json",
                      "docs/findings.md",
                    ],
                    withinBudget: true,
                    operators: [],
                  },
                  artifacts: [
                    {
                      id: "cycle-001-report",
                      path: "reports/cycle-001.json",
                    },
                  ],
                }),
                decision: {
                  decisionId: "decision-002",
                  runId: "run-002",
                  outcome: "accepted",
                  actorType: "system",
                  policyType: "ratchet",
                  reason: "metric improved",
                  createdAt: "2026-04-12T00:02:00.000Z",
                  frontierChanged: true,
                  beforeFrontierIds: [],
                  afterFrontierIds: ["frontier-002"],
                  auditRequired: false,
                },
                frontier: [
                  {
                    frontierId: "frontier-002",
                    runId: "run-002",
                    candidateId: "candidate-001",
                    acceptedAt: "2026-04-12T00:02:00.000Z",
                    metrics: {},
                    artifacts: [],
                  },
                ],
                auditQueue: [],
              },
            };
          }

          return {
            status: "accepted",
            manifestPath: join(tempRoot, "ralph.yaml"),
            lockPath: join(tempRoot, ".ralph", "lock"),
            runResult: {
              status: "accepted",
              run: makeRunRecord({
                runId: "run-003",
                cycle: 2,
                candidateId: "candidate-002",
                status: "accepted",
                proposal: {
                  proposerType: "codex_cli",
                  summary: "Resume from the persisted checkpoint and generate the next holdout bundle.",
                  diffLines: 23,
                  filesChanged: 2,
                  changedPaths: [
                    "reports/cycle-002.json",
                    "docs/findings.md",
                  ],
                  withinBudget: true,
                  operators: [],
                },
                artifacts: [
                  {
                    id: "cycle-002-report",
                    path: "reports/cycle-002.json",
                  },
                ],
              }),
              decision: {
                decisionId: "decision-003",
                runId: "run-003",
                outcome: "accepted",
                actorType: "system",
                policyType: "ratchet",
                delta: 0.07,
                reason: "the resumed cycle improved the holdout ranking",
                createdAt: "2026-04-12T00:05:00.000Z",
                frontierChanged: true,
                beforeFrontierIds: ["frontier-002"],
                afterFrontierIds: ["frontier-003"],
                auditRequired: false,
              },
              frontier: [
                {
                  frontierId: "frontier-003",
                  runId: "run-003",
                  candidateId: "candidate-002",
                  acceptedAt: "2026-04-12T00:05:00.000Z",
                  metrics: {},
                  artifacts: [],
                },
              ],
              auditQueue: [],
            },
          };
        },
      },
    });

    const interrupted = await service.runCycles({
      repoRoot: tempRoot,
      sessionId: "session-001",
      maxCycles: 3,
    });

    expect(runCalls).toBe(1);
    expect(interrupted).toMatchObject({
      cyclesExecuted: 1,
      steps: [
        {
          step: "cycle_checkpointed",
          session: {
            status: "running",
            progress: {
              completedCycles: 1,
              nextCycle: 2,
              latestRunId: "run-002",
              latestDecisionId: "decision-002",
              latestFrontierIds: ["frontier-002"],
            },
            resume: {
              resumeFromCycle: 2,
              checkpointRunId: "run-002",
              checkpointDecisionId: "decision-002",
            },
          },
        },
      ],
      session: {
        status: "awaiting_resume",
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-002"],
        },
        resume: {
          resumable: true,
          resumeFromCycle: 2,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          requiresUserConfirmation: true,
          interruptionDetectedAt: "2026-04-12T00:03:00.000Z",
          interruptedDuringCycle: 2,
          note: "Operator stopped the terminal session after cycle 1 checkpoint.",
        },
      },
    });

    const persistedInterrupted = await repository.loadSession("session-001");
    expect(persistedInterrupted).toMatchObject({
      status: "awaiting_resume",
      progress: {
        completedCycles: 1,
        nextCycle: 2,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-002"],
      },
      resume: {
        resumable: true,
        resumeFromCycle: 2,
        checkpointRunId: "run-002",
        checkpointDecisionId: "decision-002",
        requiresUserConfirmation: true,
        interruptedDuringCycle: 2,
      },
    });

    const resumed = await service.continueSession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(resumed).toMatchObject({
      step: "session_resumed",
      session: {
        status: "running",
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-002"],
        },
        resume: {
          resumable: true,
          resumeFromCycle: 2,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          requiresUserConfirmation: false,
        },
      },
    });
    expect(resumed.session.resume.interruptionDetectedAt).toBeUndefined();
    expect(resumed.session.resume.interruptedDuringCycle).toBeUndefined();
    expect(resumed.session.resume.note).toBeUndefined();

    const completed = await service.runCycles({
      repoRoot: tempRoot,
      sessionId: "session-001",
      maxCycles: 1,
    });

    expect(runCalls).toBe(2);
    expect(completed).toMatchObject({
      cyclesExecuted: 1,
      steps: [
        {
          step: "cycle_checkpointed",
          session: {
            status: "running",
            progress: {
              completedCycles: 2,
              nextCycle: 3,
              latestRunId: "run-003",
              latestDecisionId: "decision-003",
              latestFrontierIds: ["frontier-003"],
            },
            resume: {
              resumable: true,
              resumeFromCycle: 3,
              checkpointRunId: "run-003",
              checkpointDecisionId: "decision-003",
              requiresUserConfirmation: false,
            },
          },
          cycle: {
            run: {
              runId: "run-003",
              cycle: 2,
            },
          },
        },
      ],
      session: {
        status: "running",
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-003",
          latestDecisionId: "decision-003",
          latestFrontierIds: ["frontier-003"],
        },
      },
    });

    const persistedResumed = await repository.loadSession("session-001");
    expect(persistedResumed).toMatchObject({
      status: "running",
      progress: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-003",
        latestDecisionId: "decision-003",
        latestFrontierIds: ["frontier-003"],
      },
      resume: {
        resumable: true,
        resumeFromCycle: 3,
        checkpointRunId: "run-003",
        checkpointDecisionId: "decision-003",
        requiresUserConfirmation: false,
      },
    });
    expect(persistedResumed?.resume.interruptionDetectedAt).toBeUndefined();
    expect(persistedResumed?.resume.interruptedDuringCycle).toBeUndefined();
    expect(persistedResumed?.resume.note).toBeUndefined();
    expect(persistedResumed?.endedAt).toBeUndefined();
  });

  it("runs successive cycles in one orchestration pass and persists each completed-cycle checkpoint", async () => {
    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await launchService.launch({
      goal: "Reach 70% future holdout top-3 prediction success.",
      repoRoot: tempRoot,
    });

    const baseRepository = createRepository(tempRoot);
    const persistedCheckpoints: ResearchSessionRecord[] = [];
    const repository: ResearchSessionRepository = {
      saveSession: async (record) => {
        await baseRepository.saveSession(record);
        if (record.status !== "running" || record.progress.completedCycles < 1) {
          return;
        }

        const persisted = await baseRepository.loadSession(record.sessionId);
        if (!persisted) {
          throw new Error(`Expected persisted checkpoint for ${record.sessionId}`);
        }

        persistedCheckpoints.push(persisted);
      },
      loadSession: async (sessionId) => baseRepository.loadSession(sessionId),
      querySessions: async (query) => baseRepository.querySessions(query),
    };

    const timestamps = [
      "2026-04-12T00:05:00.000Z",
      "2026-04-12T00:06:00.000Z",
      "2026-04-12T00:07:00.000Z",
    ];
    let nowIndex = 0;
    let runCalls = 0;
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date(timestamps[nowIndex++] ?? timestamps.at(-1)!),
      createSessionId: () => "session-20260412-000500",
      createRepository: () => repository,
      runCycleService: {
        run: async () => {
          runCalls += 1;
          if (runCalls === 1) {
            const run = makeRunRecord({
              runId: "run-101",
              cycle: 1,
              status: "accepted",
              proposal: {
                proposerType: "codex_cli",
                summary: "Write the first future holdout bundle.",
                diffLines: 19,
                filesChanged: 2,
                changedPaths: [
                  "reports/cycle-001.json",
                  "docs/findings.md",
                ],
                withinBudget: true,
                operators: [],
              },
              artifacts: [
                {
                  id: "cycle-001-report",
                  path: "reports/cycle-001.json",
                },
              ],
            });

            return {
              status: "accepted",
              manifestPath: join(tempRoot, "ralph.yaml"),
              lockPath: join(tempRoot, ".ralph", "lock"),
              runResult: {
                status: "accepted",
                run,
                decision: {
                  decisionId: "decision-101",
                  runId: "run-101",
                  outcome: "accepted",
                  actorType: "system",
                  policyType: "ratchet",
                  delta: 0.08,
                  reason: "first future holdout bundle improved the baseline",
                  createdAt: "2026-04-12T00:05:30.000Z",
                  frontierChanged: true,
                  beforeFrontierIds: [],
                  afterFrontierIds: ["frontier-101"],
                  auditRequired: false,
                },
                frontier: [
                  {
                    frontierId: "frontier-101",
                    runId: "run-101",
                    candidateId: "candidate-001",
                    acceptedAt: "2026-04-12T00:05:30.000Z",
                    metrics: {},
                    artifacts: [],
                  },
                ],
                auditQueue: [],
              },
            };
          }

          const run = makeRunRecord({
            runId: "run-102",
            cycle: 2,
            candidateId: "candidate-002",
            status: "accepted",
            proposal: {
              proposerType: "codex_cli",
              summary: "Write the second future holdout bundle.",
              diffLines: 27,
              filesChanged: 3,
              changedPaths: [
                "reports/cycle-002.json",
                "reports/feature-ranking.json",
                "docs/findings.md",
              ],
              withinBudget: true,
              operators: [],
            },
            artifacts: [
              {
                id: "cycle-002-report",
                path: "reports/cycle-002.json",
              },
            ],
          });

          return {
            status: "accepted",
            manifestPath: join(tempRoot, "ralph.yaml"),
            lockPath: join(tempRoot, ".ralph", "lock"),
            runResult: {
              status: "accepted",
              run,
              decision: {
                decisionId: "decision-102",
                runId: "run-102",
                outcome: "accepted",
                actorType: "system",
                policyType: "ratchet",
                delta: 0.11,
                reason: "second future holdout bundle improved the top-3 target",
                createdAt: "2026-04-12T00:06:30.000Z",
                frontierChanged: true,
                beforeFrontierIds: ["frontier-101"],
                afterFrontierIds: ["frontier-102"],
                auditRequired: false,
              },
              frontier: [
                {
                  frontierId: "frontier-102",
                  runId: "run-102",
                  candidateId: "candidate-002",
                  acceptedAt: "2026-04-12T00:06:30.000Z",
                  metrics: {},
                  artifacts: [],
                },
              ],
              auditQueue: [],
            },
          };
        },
      },
    });

    const started = await service.startSession({
      repoRoot: tempRoot,
      draftSessionId: launch.sessionId,
    });
    const result = await service.runCycles({
      repoRoot: tempRoot,
      sessionId: started.session.sessionId,
      maxCycles: 2,
    });

    expect(runCalls).toBe(2);
    expect(result).toMatchObject({
      cyclesExecuted: 2,
      steps: [
        {
          step: "cycle_checkpointed",
          cycle: {
            latestRunId: "run-101",
            latestDecisionId: "decision-101",
            latestFrontierIds: ["frontier-101"],
          },
        },
        {
          step: "cycle_checkpointed",
          cycle: {
            latestRunId: "run-102",
            latestDecisionId: "decision-102",
            latestFrontierIds: ["frontier-102"],
          },
        },
      ],
      session: {
        sessionId: "session-20260412-000500",
        status: "running",
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-102",
          latestDecisionId: "decision-102",
          latestFrontierIds: ["frontier-102"],
        },
      },
    });

    expect(persistedCheckpoints).toHaveLength(2);
    expect(persistedCheckpoints[0]).toMatchObject({
      sessionId: "session-20260412-000500",
      status: "running",
      progress: {
        completedCycles: 1,
        nextCycle: 2,
        latestRunId: "run-101",
        latestDecisionId: "decision-101",
        latestFrontierIds: ["frontier-101"],
        lastCheckpointAt: "2026-04-12T00:06:00.000Z",
        lastSignals: {
          cycle: 1,
          changedFileCount: 2,
          diffLineCount: 19,
          verificationDelta: 0.08,
          newArtifacts: ["reports/cycle-001.json"],
          meaningfulProgress: true,
          insufficientEvidence: false,
        },
      },
      resume: {
        resumeFromCycle: 2,
        checkpointRunId: "run-101",
        checkpointDecisionId: "decision-101",
      },
    });
    expect(persistedCheckpoints[1]).toMatchObject({
      sessionId: "session-20260412-000500",
      status: "running",
      progress: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-102",
        latestDecisionId: "decision-102",
        latestFrontierIds: ["frontier-102"],
        lastCheckpointAt: "2026-04-12T00:07:00.000Z",
        lastSignals: {
          cycle: 2,
          changedFileCount: 3,
          diffLineCount: 27,
          verificationDelta: 0.11,
          newArtifacts: ["reports/cycle-002.json"],
          meaningfulProgress: true,
          insufficientEvidence: false,
        },
      },
      resume: {
        resumeFromCycle: 3,
        checkpointRunId: "run-102",
        checkpointDecisionId: "decision-102",
      },
    });

    const persisted = await baseRepository.loadSession("session-20260412-000500");
    expect(persisted).not.toBeNull();
    expect(persisted).toMatchObject(persistedCheckpoints[1]!);
  });

  it("steps fresh sessions one cycle at a time and returns the current cycle models after each iteration", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(makeSession());

    const timestamps = [
      "2026-04-12T00:03:00.000Z",
      "2026-04-12T00:04:00.000Z",
    ];
    let nowIndex = 0;
    let runCalls = 0;
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date(timestamps[nowIndex++] ?? timestamps.at(-1)!),
      recoveryService: {
        classifySession: async () => ({
          classification: "resumable",
          resumeAllowed: true,
          reason: "Codex CLI exited cleanly before cycle 2 completed",
          runtime: {
            state: "exited",
            processAlive: false,
            stale: false,
            phase: "clean_exit",
          },
        }),
      },
      runCycleService: {
        run: async () => {
          runCalls += 1;
          if (runCalls === 1) {
            const run = makeRunRecord({
              runId: "run-101",
              cycle: 1,
              status: "accepted",
              proposal: {
                proposerType: "codex_cli",
                summary: "Generate the first holdout evaluation bundle.",
                diffLines: 19,
                filesChanged: 2,
                changedPaths: [
                  "reports/cycle-001.json",
                  "docs/findings.md",
                ],
                withinBudget: true,
                operators: [],
              },
              artifacts: [
                {
                  id: "cycle-001-report",
                  path: "reports/cycle-001.json",
                },
              ],
            });

            return {
              status: "accepted",
              manifestPath: join(tempRoot, "ralph.yaml"),
              lockPath: join(tempRoot, ".ralph", "lock"),
              runResult: {
                status: "accepted",
                run,
                decision: {
                  decisionId: "decision-101",
                  runId: "run-101",
                  outcome: "accepted",
                  actorType: "system",
                  policyType: "ratchet",
                  delta: 0.08,
                  reason: "first holdout report improved the baseline",
                  createdAt: "2026-04-12T00:02:00.000Z",
                  frontierChanged: true,
                  beforeFrontierIds: [],
                  afterFrontierIds: ["frontier-101"],
                  auditRequired: false,
                },
                frontier: [
                  {
                    frontierId: "frontier-101",
                    runId: "run-101",
                    candidateId: "candidate-001",
                    acceptedAt: "2026-04-12T00:02:00.000Z",
                    metrics: {},
                    artifacts: [],
                  },
                ],
                auditQueue: [],
              },
            };
          }

          const run = makeRunRecord({
            runId: "run-102",
            cycle: 2,
            candidateId: "candidate-002",
            status: "accepted",
            proposal: {
              proposerType: "codex_cli",
              summary: "Refine the holdout ranking using the prior report.",
              diffLines: 27,
              filesChanged: 3,
              changedPaths: [
                "reports/cycle-002.json",
                "reports/feature-ranking.json",
                "docs/findings.md",
              ],
              withinBudget: true,
              operators: [],
            },
            artifacts: [
              {
                id: "cycle-002-report",
                path: "reports/cycle-002.json",
              },
            ],
          });

          return {
            status: "accepted",
            manifestPath: join(tempRoot, "ralph.yaml"),
            lockPath: join(tempRoot, ".ralph", "lock"),
            runResult: {
              status: "accepted",
              run,
              decision: {
                decisionId: "decision-102",
                runId: "run-102",
                outcome: "accepted",
                actorType: "system",
                policyType: "ratchet",
                delta: 0.11,
                reason: "the second holdout report improved the top-3 target",
                createdAt: "2026-04-12T00:03:30.000Z",
                frontierChanged: true,
                beforeFrontierIds: ["frontier-101"],
                afterFrontierIds: ["frontier-102"],
                auditRequired: false,
              },
              frontier: [
                {
                  frontierId: "frontier-102",
                  runId: "run-102",
                  candidateId: "candidate-002",
                  acceptedAt: "2026-04-12T00:03:30.000Z",
                  metrics: {},
                  artifacts: [],
                },
              ],
              auditQueue: [],
            },
          };
        },
      },
    });

    const firstStep = await service.step({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(runCalls).toBe(1);
    expect(firstStep).toMatchObject({
      step: "cycle_checkpointed",
      session: {
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-101",
          latestDecisionId: "decision-101",
          latestFrontierIds: ["frontier-101"],
        },
        resume: {
          resumeFromCycle: 2,
          checkpointRunId: "run-101",
          checkpointDecisionId: "decision-101",
        },
      },
      cycle: {
        completedCycles: 1,
        nextCycle: 2,
        latestRunId: "run-101",
        latestDecisionId: "decision-101",
        latestFrontierIds: ["frontier-101"],
        run: {
          runId: "run-101",
          cycle: 1,
        },
        decision: {
          decisionId: "decision-101",
          runId: "run-101",
        },
      },
    });
    expect(firstStep.cycle.run).toMatchObject({
      runId: "run-101",
      cycle: 1,
      status: "accepted",
    });
    expect(firstStep.cycle.decision).toMatchObject({
      decisionId: "decision-101",
      runId: "run-101",
      outcome: "accepted",
    });

    const persistedAfterFirst = await repository.loadSession("session-001");
    expect(persistedAfterFirst).not.toBeNull();
    expect(persistedAfterFirst?.progress.completedCycles).toBe(1);
    expect(persistedAfterFirst?.progress.nextCycle).toBe(2);
    expect(persistedAfterFirst?.progress.latestRunId).toBe("run-101");
    expect(persistedAfterFirst?.resume.checkpointRunId).toBe("run-101");

    const secondStep = await service.step({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(runCalls).toBe(2);
    expect(secondStep).toMatchObject({
      step: "cycle_checkpointed",
      session: {
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-102",
          latestDecisionId: "decision-102",
          latestFrontierIds: ["frontier-102"],
        },
        resume: {
          resumeFromCycle: 3,
          checkpointRunId: "run-102",
          checkpointDecisionId: "decision-102",
        },
      },
      cycle: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-102",
        latestDecisionId: "decision-102",
        latestFrontierIds: ["frontier-102"],
        run: {
          runId: "run-102",
          cycle: 2,
        },
        decision: {
          decisionId: "decision-102",
          runId: "run-102",
        },
      },
    });
    expect(secondStep.cycle.run).toMatchObject({
      runId: "run-102",
      cycle: 2,
      status: "accepted",
    });
    expect(secondStep.cycle.decision).toMatchObject({
      decisionId: "decision-102",
      runId: "run-102",
      outcome: "accepted",
    });

    const persistedAfterSecond = await repository.loadSession("session-001");
    expect(persistedAfterSecond).not.toBeNull();
    expect(persistedAfterSecond?.progress.completedCycles).toBe(2);
    expect(persistedAfterSecond?.progress.nextCycle).toBe(3);
    expect(persistedAfterSecond?.progress.latestRunId).toBe("run-102");
    expect(persistedAfterSecond?.resume.checkpointRunId).toBe("run-102");
  });

  it("resumes from the next checkpoint boundary and steps only the next cycle", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(
      makeSession({
        status: "awaiting_resume",
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-101",
          latestDecisionId: "decision-101",
          latestFrontierIds: ["frontier-101"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 1,
          lastCheckpointAt: "2026-04-12T00:03:00.000Z",
          lastSignals: {
            cycle: 1,
            outcome: "accepted",
            changedFileCount: 2,
            diffLineCount: 19,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["Checkpointed the first holdout evaluation bundle."],
            newArtifacts: ["reports/cycle-001.json"],
            repeatedDiff: false,
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 2,
          requiresUserConfirmation: true,
          checkpointRunId: "run-101",
          checkpointDecisionId: "decision-101",
          interruptionDetectedAt: "2026-04-12T00:03:30.000Z",
          interruptedDuringCycle: 2,
          note: "tty disconnected before cycle 2 started",
        },
      }),
    );

    const timestamps = [
      "2026-04-12T00:04:00.000Z",
      "2026-04-12T00:05:00.000Z",
    ];
    let nowIndex = 0;
    let runCalls = 0;
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date(timestamps[nowIndex++] ?? timestamps.at(-1)!),
      recoveryService: {
        classifySession: async () => ({
          classification: "resumable",
          resumeAllowed: true,
          reason: "Codex CLI exited cleanly before cycle 2 completed",
          runtime: {
            state: "exited",
            processAlive: false,
            stale: false,
            phase: "clean_exit",
          },
        }),
      },
      runCycleService: {
        run: async () => {
          runCalls += 1;
          const run = makeRunRecord({
            runId: "run-102",
            cycle: 2,
            candidateId: "candidate-002",
            status: "accepted",
            proposal: {
              proposerType: "codex_cli",
              summary: "Resume from the saved checkpoint and generate the next bundle.",
              diffLines: 24,
              filesChanged: 2,
              changedPaths: [
                "reports/cycle-002.json",
                "docs/findings.md",
              ],
              withinBudget: true,
              operators: [],
            },
            artifacts: [
              {
                id: "cycle-002-report",
                path: "reports/cycle-002.json",
              },
            ],
          });

          return {
            status: "accepted",
            manifestPath: join(tempRoot, "ralph.yaml"),
            lockPath: join(tempRoot, ".ralph", "lock"),
            runResult: {
              status: "accepted",
              run,
              decision: {
                decisionId: "decision-102",
                runId: "run-102",
                outcome: "accepted",
                actorType: "system",
                policyType: "ratchet",
                delta: 0.09,
                reason: "the resumed cycle improved the future holdout score",
                createdAt: "2026-04-12T00:04:30.000Z",
                frontierChanged: true,
                beforeFrontierIds: ["frontier-101"],
                afterFrontierIds: ["frontier-102"],
                auditRequired: false,
              },
              frontier: [
                {
                  frontierId: "frontier-102",
                  runId: "run-102",
                  candidateId: "candidate-002",
                  acceptedAt: "2026-04-12T00:04:30.000Z",
                  metrics: {},
                  artifacts: [],
                },
              ],
              auditQueue: [],
            },
          };
        },
      },
    });

    const resumed = await service.resumeSession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(runCalls).toBe(0);
    expect(resumed).toMatchObject({
      step: "session_resumed",
      session: {
        status: "running",
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-101",
          latestDecisionId: "decision-101",
        },
        resume: {
          resumeFromCycle: 2,
          checkpointRunId: "run-101",
          checkpointDecisionId: "decision-101",
          requiresUserConfirmation: false,
        },
      },
    });

    const stepped = await service.step({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(runCalls).toBe(1);
    expect(stepped).toMatchObject({
      step: "cycle_checkpointed",
      session: {
        status: "running",
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-102",
          latestDecisionId: "decision-102",
          latestFrontierIds: ["frontier-102"],
        },
        resume: {
          resumeFromCycle: 3,
          checkpointRunId: "run-102",
          checkpointDecisionId: "decision-102",
          requiresUserConfirmation: false,
        },
      },
      cycle: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-102",
        latestDecisionId: "decision-102",
        latestFrontierIds: ["frontier-102"],
        run: {
          runId: "run-102",
          cycle: 2,
        },
        decision: {
          decisionId: "decision-102",
          runId: "run-102",
        },
      },
    });
    expect(stepped.cycle.run).toMatchObject({
      runId: "run-102",
      cycle: 2,
      status: "accepted",
    });
    expect(stepped.cycle.decision).toMatchObject({
      decisionId: "decision-102",
      runId: "run-102",
      outcome: "accepted",
    });

    const persisted = await repository.loadSession("session-001");
    expect(persisted).not.toBeNull();
    expect(persisted?.status).toBe("running");
    expect(persisted?.progress.completedCycles).toBe(2);
    expect(persisted?.progress.nextCycle).toBe(3);
    expect(persisted?.progress.latestRunId).toBe("run-102");
    expect(persisted?.resume.resumeFromCycle).toBe(3);
    expect(persisted?.resume.checkpointRunId).toBe("run-102");
  });

  it("halts after checkpointing when a completed cycle returns needs_human at the cycle boundary", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(makeSession());

    const run = makeRunRecord({
      runId: "run-003",
      cycle: 1,
      status: "needs_human",
      artifacts: [
        {
          id: "manual-review-report",
          path: "reports/manual-review-003.json",
        },
      ],
      proposal: {
        proposerType: "codex_cli",
        summary: "Produce a candidate that still needs operator judgment.",
        diffLines: 18,
        filesChanged: 2,
        changedPaths: [
          "reports/manual-review-003.json",
          "docs/review-notes.md",
        ],
        withinBudget: true,
        operators: [],
      },
    });
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:04:00.000Z"),
      runCycleService: {
        run: async () => ({
          status: "needs_human",
          manifestPath: join(tempRoot, "ralph.yaml"),
          lockPath: join(tempRoot, ".ralph", "lock"),
          runResult: {
            status: "needs_human",
            run,
            decision: {
              decisionId: "decision-003",
              runId: "run-003",
              outcome: "needs_human",
              actorType: "system",
              policyType: "approval_gate",
              reason: "confidence stayed below the auto-accept threshold",
              createdAt: "2026-04-12T00:03:00.000Z",
              frontierChanged: false,
              beforeFrontierIds: [],
              afterFrontierIds: [],
              auditRequired: false,
            },
            frontier: [],
            auditQueue: [],
          },
        }),
      },
    });

    const stepped = await service.step({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(stepped).toMatchObject({
      step: "session_halted",
      session: {
        sessionId: "session-001",
        status: "halted",
        stopCondition: {
          type: "operator_stop",
          note: "Cycle 1 requires manual review before continuing.",
        },
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-003",
          latestDecisionId: "decision-003",
          latestFrontierIds: [],
          lastCheckpointAt: "2026-04-12T00:04:00.000Z",
          lastSignals: {
            cycle: 1,
            outcome: "needs_human",
            changedFileCount: 2,
            diffLineCount: 18,
            meaningfulProgress: true,
            insufficientEvidence: false,
          },
        },
        resume: {
          resumeFromCycle: 2,
          checkpointRunId: "run-003",
          checkpointDecisionId: "decision-003",
          requiresUserConfirmation: true,
        },
      },
      cycle: {
        completedCycles: 1,
        nextCycle: 2,
        latestRunId: "run-003",
        latestDecisionId: "decision-003",
        run: {
          runId: "run-003",
          cycle: 1,
        },
        decision: {
          decisionId: "decision-003",
          runId: "run-003",
        },
      },
    });

    const persisted = await repository.loadSession("session-001");
    expect(persisted?.status).toBe("halted");
    expect(persisted?.resume.checkpointRunId).toBe("run-003");
  });

  it("halts after checkpointing when a failed cycle reaches the repeated-failure threshold", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(
      makeSession({
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-001",
          latestDecisionId: "decision-001",
          latestFrontierIds: ["frontier-001"],
          repeatedFailureStreak: 2,
          noMeaningfulProgressStreak: 1,
          insufficientEvidenceStreak: 1,
          lastMeaningfulProgressCycle: 1,
          lastCheckpointAt: "2026-04-12T00:09:00.000Z",
          lastSignals: {
            cycle: 1,
            outcome: "failed",
            changedFileCount: 0,
            diffLineCount: 0,
            meaningfulProgress: false,
            insufficientEvidence: true,
            agentTieBreakerUsed: false,
            reasons: ["Previous cycle failed without durable evidence."],
            newArtifacts: [],
            repeatedDiff: false,
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 2,
          requiresUserConfirmation: false,
          checkpointRunId: "run-001",
          checkpointDecisionId: "decision-001",
        },
      }),
    );
    const run = makeRunRecord({
      runId: "run-004",
      cycle: 2,
      status: "failed",
      phase: "failed",
      pendingAction: "none",
      endedAt: "2026-04-12T00:10:00.000Z",
      error: {
        message: "verification command exited non-zero",
      },
      proposal: {
        proposerType: "codex_cli",
        summary: "Attempt another verifier repair.",
        diffLines: 0,
        filesChanged: 0,
        changedPaths: [],
        withinBudget: true,
        operators: [],
      },
    });
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:11:00.000Z"),
      runCycleService: {
        run: async () => ({
          status: "failed",
          manifestPath: join(tempRoot, "ralph.yaml"),
          lockPath: join(tempRoot, ".ralph", "lock"),
          runResult: {
            status: "failed",
            run,
            frontier: [
              {
                frontierId: "frontier-001",
                runId: "run-001",
                candidateId: "candidate-001",
                acceptedAt: "2026-04-12T00:01:00.000Z",
                metrics: {},
                artifacts: [],
              },
            ],
            auditQueue: [],
          },
        }),
      },
    });

    const stepped = await service.step({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(stepped).toMatchObject({
      step: "session_halted",
      session: {
        status: "halted",
        stopCondition: {
          type: "repeated_failures",
          count: 3,
          threshold: 3,
        },
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-004",
          latestFrontierIds: ["frontier-001"],
          repeatedFailureStreak: 3,
          noMeaningfulProgressStreak: 2,
          insufficientEvidenceStreak: 2,
          lastMeaningfulProgressCycle: 1,
          lastCheckpointAt: "2026-04-12T00:11:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "failed",
            meaningfulProgress: false,
            insufficientEvidence: true,
          },
        },
        resume: {
          resumeFromCycle: 3,
          checkpointRunId: "run-004",
          requiresUserConfirmation: true,
        },
      },
      cycle: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-004",
        latestFrontierIds: ["frontier-001"],
        run: {
          runId: "run-004",
          cycle: 2,
        },
      },
    });

    const persisted = await repository.loadSession("session-001");
    expect(persisted?.stopCondition).toEqual({
      type: "repeated_failures",
      count: 3,
      threshold: 3,
    });
    expect(persisted?.resume.checkpointRunId).toBe("run-004");
  });

  it("persists the final post-cycle session state atomically when a completed cycle hits a stop threshold", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(
      makeSession({
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-001",
          latestDecisionId: "decision-001",
          latestFrontierIds: ["frontier-001"],
          repeatedFailureStreak: 1,
          noMeaningfulProgressStreak: 2,
          insufficientEvidenceStreak: 2,
          lastMeaningfulProgressCycle: 1,
          lastCheckpointAt: "2026-04-12T00:10:00.000Z",
          lastSignals: {
            cycle: 1,
            outcome: "failed",
            changedFileCount: 0,
            diffLineCount: 0,
            meaningfulProgress: false,
            insufficientEvidence: true,
            agentTieBreakerUsed: false,
            reasons: ["No verifiable artifact survived the cycle."],
            newArtifacts: [],
            repeatedDiff: true,
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 2,
          requiresUserConfirmation: false,
          checkpointRunId: "run-001",
          checkpointDecisionId: "decision-001",
        },
      }),
    );
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:15:00.000Z"),
    });

    const checkpoint = await service.recordCompletedCycle({
      repoRoot: tempRoot,
      sessionId: "session-001",
      run: makeRunRecord({
        runId: "run-002",
        cycle: 2,
        status: "failed",
        phase: "failed",
        pendingAction: "none",
        endedAt: "2026-04-12T00:14:00.000Z",
        error: {
          message: "verification failed",
        },
      }),
      decision: null,
      frontierIds: ["frontier-001"],
      signal: {
        outcome: "failed",
        changedFileCount: 1,
        diffLineCount: 9,
        repeatedDiff: true,
        meaningfulProgress: false,
        insufficientEvidence: true,
        agentTieBreakerUsed: false,
        reasons: ["The verifier output stayed below the success target."],
        newArtifacts: ["reports/cycle-002.log"],
      },
    });

    expect(checkpoint).toMatchObject({
      step: "session_halted",
      session: {
        status: "halted",
        stopCondition: {
          type: "insufficient_evidence",
          count: 3,
          threshold: 3,
        },
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestFrontierIds: ["frontier-001"],
          repeatedFailureStreak: 2,
          noMeaningfulProgressStreak: 3,
          insufficientEvidenceStreak: 3,
          lastMeaningfulProgressCycle: 1,
          lastCheckpointAt: "2026-04-12T00:15:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "failed",
          },
        },
        resume: {
          resumeFromCycle: 3,
          checkpointRunId: "run-002",
          requiresUserConfirmation: true,
        },
      },
      cycle: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestFrontierIds: ["frontier-001"],
        run: {
          runId: "run-002",
          cycle: 2,
        },
      },
    });
    expect(checkpoint.session.progress.latestDecisionId).toBeUndefined();
    expect(checkpoint.session.resume.checkpointDecisionId).toBeUndefined();

    const persisted = await repository.loadSession("session-001");
    expect(persisted?.status).toBe("halted");
    expect(persisted?.stopCondition).toEqual({
      type: "insufficient_evidence",
      count: 3,
      threshold: 3,
    });
    expect(persisted?.resume.resumeFromCycle).toBe(3);
    expect(persisted?.resume.checkpointRunId).toBe("run-002");
  });

  it("marks interruptions as awaiting_resume from the next cycle after the last completed checkpoint", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(
      makeSession({
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-002"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 2,
          lastCheckpointAt: "2026-04-12T00:15:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 4,
            diffLineCount: 55,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["Added a fresh holdout evaluation bundle."],
            newArtifacts: ["reports/holdout-002.json"],
            repeatedDiff: false,
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: false,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
        },
      }),
    );
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:16:00.000Z"),
    });

    const interrupted = await service.recordInterruption({
      repoRoot: tempRoot,
      sessionId: "session-001",
      note: "SIGTERM while the agent was preparing cycle 3",
    });

    expect(interrupted).toMatchObject({
      step: "session_interrupted",
      session: {
        status: "awaiting_resume",
        resume: {
          resumeFromCycle: 3,
          requiresUserConfirmation: true,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          interruptionDetectedAt: "2026-04-12T00:16:00.000Z",
          interruptedDuringCycle: 3,
          note: "SIGTERM while the agent was preparing cycle 3",
        },
        stopCondition: {
          type: "none",
        },
      },
    });
  });

  it("persists halted sessions once a stop threshold is hit and keeps the last checkpoint intact", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(
      makeSession({
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-002"],
          repeatedFailureStreak: 3,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 1,
          lastCheckpointAt: "2026-04-12T00:15:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "failed",
            changedFileCount: 1,
            diffLineCount: 9,
            meaningfulProgress: false,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["Repeated verifier failure."],
            newArtifacts: [],
            repeatedDiff: true,
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: false,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
        },
      }),
    );
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:17:00.000Z"),
    });

    const halted = await service.haltSession({
      repoRoot: tempRoot,
      sessionId: "session-001",
      stopCondition: {
        type: "repeated_failures",
        count: 3,
        threshold: 3,
      },
    });

    expect(halted).toMatchObject({
      step: "session_halted",
      session: {
        status: "halted",
        stopCondition: {
          type: "repeated_failures",
          count: 3,
          threshold: 3,
        },
        resume: {
          resumeFromCycle: 3,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          requiresUserConfirmation: true,
        },
      },
    });
    expect(halted.session.progress.lastCheckpointAt).toBe("2026-04-12T00:15:00.000Z");
  });

  it("persists terminal goal_achieved and failed states with evidence required for inspection", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(
      makeSession({
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-002"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 2,
          lastCheckpointAt: "2026-04-12T00:15:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 5,
            diffLineCount: 61,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["Future holdout verifier crossed the target."],
            newArtifacts: ["reports/future-holdout.json"],
            repeatedDiff: false,
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: false,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
        },
      }),
    );
    const completeService = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:18:00.000Z"),
    });

    const completed = await completeService.completeSession({
      repoRoot: tempRoot,
      sessionId: "session-001",
      summary: "Future holdout top-3 success reached 72%.",
      evidenceBundlePath: ".ralph/sessions/session-001/evidence",
      promotion: {
        promotedRunId: "run-002",
        promotedDecisionId: "decision-002",
        promotedCommitSha: "abc123",
      },
    });

    expect(completed).toMatchObject({
      step: "session_completed",
      session: {
        status: "goal_achieved",
        evidenceBundlePath: ".ralph/sessions/session-001/evidence",
        stopCondition: {
          type: "goal_achieved",
          summary: "Future holdout top-3 success reached 72%.",
          achievedAtCycle: 2,
        },
        workspace: {
          promoted: true,
          promotedAt: "2026-04-12T00:18:00.000Z",
          promotedRunId: "run-002",
          promotedDecisionId: "decision-002",
          promotedCommitSha: "abc123",
        },
      },
    });
    expect(completed.session.endedAt).toBe("2026-04-12T00:18:00.000Z");

    await repository.saveSession(
      makeSession({
        sessionId: "session-002",
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-101",
          latestDecisionId: "decision-101",
          latestFrontierIds: ["frontier-101"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 1,
          lastCheckpointAt: "2026-04-12T00:20:00.000Z",
          lastSignals: {
            cycle: 1,
            outcome: "rejected",
            changedFileCount: 2,
            diffLineCount: 23,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["Artifacts were written before the crash."],
            newArtifacts: ["reports/cycle-101.json"],
            repeatedDiff: false,
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 2,
          requiresUserConfirmation: false,
          checkpointRunId: "run-101",
          checkpointDecisionId: "decision-101",
        },
      }),
    );
    const failService = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:21:00.000Z"),
    });

    const failed = await failService.failSession({
      repoRoot: tempRoot,
      sessionId: "session-002",
      message: "codex tty session died before a clean checkpoint",
    });

    expect(failed).toMatchObject({
      step: "session_failed",
      session: {
        status: "failed",
        stopCondition: {
          type: "unrecoverable_error",
          message: "codex tty session died before a clean checkpoint",
        },
      },
    });
    expect(failed.session.endedAt).toBe("2026-04-12T00:21:00.000Z");
  });

  it("reassociates the lifecycle and session workspace metadata to the latest completed run checkpoint", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(makeSession());
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:09:00.000Z"),
    });

    await service.recordCodexSessionLifecycle({
      repoRoot: tempRoot,
      sessionId: "session-001",
      phase: "running",
      command: "codex",
      args: ["resume"],
      pid: 321,
      attachmentStatus: "bound",
    });

    const checkpoint = await service.recordCompletedCycle({
      repoRoot: tempRoot,
      sessionId: "session-001",
      run: makeRunRecord({
        runId: "run-101",
        cycle: 1,
        workspaceRef: "refs/heads/candidate-101",
        workspacePath: join(tempRoot, ".ralph", "workspaces", "candidate-101"),
      }),
      decision: {
        decisionId: "decision-101",
        runId: "run-101",
        outcome: "accepted",
        actorType: "system",
        policyType: "ratchet",
        frontierChanged: true,
        delta: 0.12,
        reason: "Holdout verifier improved.",
        createdAt: "2026-04-12T00:08:59.000Z",
        beforeFrontierIds: [],
        afterFrontierIds: ["frontier-101"],
      },
      frontierIds: ["frontier-101"],
      signal: {
        outcome: "accepted",
        changedFileCount: 2,
        diffLineCount: 19,
        repeatedDiff: false,
        verificationDelta: 0.12,
        newArtifacts: ["reports/future-holdout.json"],
        meaningfulProgress: true,
        insufficientEvidence: false,
        agentTieBreakerUsed: false,
        reasons: ["Future holdout verifier improved."],
      },
    });

    expect(checkpoint.session.workspace).toMatchObject({
      currentRef: "refs/heads/candidate-101",
      currentPath: join(tempRoot, ".ralph", "workspaces", "candidate-101"),
    });
    expect(checkpoint.session.resume).toMatchObject({
      checkpointRunId: "run-101",
      checkpointDecisionId: "decision-101",
      resumeFromCycle: 2,
    });

    const lifecycle = JSON.parse(
      await readFile(
        join(tempRoot, ".ralph", "sessions", "session-001", "codex-session.json"),
        "utf8",
      ),
    );
    expect(lifecycle).toMatchObject({
      sessionId: "session-001",
      phase: "running",
      pid: 321,
      resumeFromCycle: 2,
      completedCycles: 1,
      attachmentState: {
        status: "bound",
      },
      references: {
        workspaceRef: "refs/heads/candidate-101",
        workspacePath: join(tempRoot, ".ralph", "workspaces", "candidate-101"),
        checkpointRunId: "run-101",
        checkpointDecisionId: "decision-101",
      },
    });

    const reloadedRepository = createRepository(tempRoot);
    const persistedBundle = await reloadedRepository.loadPersistedSession?.("session-001");
    const canonicalRepoRoot = await realpath(tempRoot);

    expect(persistedBundle).toMatchObject({
      session: {
        sessionId: "session-001",
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-101",
          latestDecisionId: "decision-101",
        },
        resume: {
          resumeFromCycle: 2,
          checkpointRunId: "run-101",
          checkpointDecisionId: "decision-101",
        },
      },
      lifecycle: {
        sessionId: "session-001",
        phase: "running",
        pid: 321,
        resumeFromCycle: 2,
        completedCycles: 1,
        references: {
          workspaceRef: "refs/heads/candidate-101",
          workspacePath: join(tempRoot, ".ralph", "workspaces", "candidate-101"),
          checkpointRunId: "run-101",
          checkpointDecisionId: "decision-101",
        },
      },
      codexSessionReference: {
        codexSessionId: "session-001",
        lifecyclePath: join(tempRoot, ".ralph", "sessions", "session-001", "codex-session.json"),
      },
    });

    const followUpLifecycleService = new CodexCliSessionLifecycleService({
      createRecoveryService: () =>
        new ResearchSessionRecoveryService({
          isProcessAlive: () => true,
        }),
    });
    const resolution = await followUpLifecycleService.resolveCycleSession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(resolution).toMatchObject({
      decision: "reuse",
      codexSessionReference: {
        codexSessionId: "session-001",
        lifecyclePath: join(canonicalRepoRoot, ".ralph", "sessions", "session-001", "codex-session.json"),
      },
      reuse: {
        researchSessionId: "session-001",
        codexSessionId: "session-001",
        pid: 321,
        phase: "running",
        workingDirectory: tempRoot,
        attachmentStatus: "bound",
        checkpointRunId: "run-101",
        checkpointDecisionId: "decision-101",
        workspaceRef: "refs/heads/candidate-101",
        workspacePath: join(tempRoot, ".ralph", "workspaces", "candidate-101"),
      },
    });
  });

  it("refreshes the persisted session record timestamp when lifecycle-only attach state changes are recorded", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(
      makeSession({
        updatedAt: "2026-04-12T00:08:00.000Z",
        workspace: {
          strategy: "git_worktree",
          currentRef: "refs/heads/candidate-101",
          currentPath: join(tempRoot, ".ralph", "workspaces", "candidate-101"),
          promoted: false,
        },
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-101",
          latestDecisionId: "decision-101",
          latestFrontierIds: ["frontier-101"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 1,
          lastCheckpointAt: "2026-04-12T00:08:00.000Z",
          lastSignals: {
            cycle: 1,
            outcome: "accepted",
            changedFileCount: 2,
            diffLineCount: 19,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["Future holdout verifier improved."],
            newArtifacts: ["reports/future-holdout.json"],
            repeatedDiff: false,
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 2,
          requiresUserConfirmation: false,
          checkpointRunId: "run-101",
          checkpointDecisionId: "decision-101",
        },
      }),
    );
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:09:00.000Z"),
    });

    await service.recordCodexSessionLifecycle({
      repoRoot: tempRoot,
      sessionId: "session-001",
      phase: "running",
      command: "codex",
      args: ["continue"],
      pid: 321,
      attachmentStatus: "bound",
    });

    const persistedSession = await repository.loadSession("session-001");
    expect(persistedSession).toMatchObject({
      sessionId: "session-001",
      updatedAt: "2026-04-12T00:09:00.000Z",
      progress: {
        completedCycles: 1,
        nextCycle: 2,
        latestRunId: "run-101",
        latestDecisionId: "decision-101",
      },
      resume: {
        resumeFromCycle: 2,
        checkpointRunId: "run-101",
        checkpointDecisionId: "decision-101",
      },
    });

    const lifecycle = JSON.parse(
      await readFile(
        join(tempRoot, ".ralph", "sessions", "session-001", "codex-session.json"),
        "utf8",
      ),
    );
    expect(lifecycle).toMatchObject({
      sessionId: "session-001",
      phase: "running",
      pid: 321,
      resumeFromCycle: 2,
      completedCycles: 1,
      attachmentState: {
        status: "bound",
      },
      references: {
        workspaceRef: "refs/heads/candidate-101",
        workspacePath: join(tempRoot, ".ralph", "workspaces", "candidate-101"),
        checkpointRunId: "run-101",
        checkpointDecisionId: "decision-101",
      },
    });
  });

  it("refreshes the persisted Codex lifecycle identity from the authoritative handle session id", async () => {
    const repository = createRepository(tempRoot);
    await repository.saveSession(makeSession());
    const service = new ResearchSessionOrchestratorService({
      now: () => new Date("2026-04-12T00:09:00.000Z"),
    });

    await service.recordCodexSessionLifecycle({
      repoRoot: tempRoot,
      sessionId: "session-001",
      phase: "running",
      command: "codex",
      args: ["resume", "codex-session-777"],
      codexSessionId: "codex-session-777",
      pid: 321,
      attachmentStatus: "bound",
    });

    const lifecycle = JSON.parse(
      await readFile(
        join(tempRoot, ".ralph", "sessions", "session-001", "codex-session.json"),
        "utf8",
      ),
    );
    expect(lifecycle).toMatchObject({
      sessionId: "session-001",
      phase: "running",
      pid: 321,
      identity: {
        researchSessionId: "session-001",
        codexSessionId: "codex-session-777",
      },
      args: ["resume", "codex-session-777"],
    });
  });
});

function createRepository(repoRoot: string) {
  return new JsonFileResearchSessionRepository(join(repoRoot, ".ralph", "sessions"));
}

function makeSession(overrides: Partial<ResearchSessionRecord> = {}): ResearchSessionRecord {
  return researchSessionRecordSchema.parse({
    sessionId: "session-001",
    goal: "Reach 70% future holdout top-3 prediction success.",
    workingDirectory: tempRoot,
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

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-001",
    cycle: 1,
    candidateId: "candidate-001",
    status: "rejected",
    phase: "completed",
    pendingAction: "none",
    startedAt: "2026-04-12T00:00:00.000Z",
    endedAt: "2026-04-12T00:01:00.000Z",
    manifestHash: "manifest-001",
    workspaceRef: "refs/heads/candidate-001",
    workspacePath: join(tempRoot, ".ralph", "workspaces", "candidate-001"),
    proposal: {
      proposerType: "codex_cli",
      summary: "Adjust the verifier bundle.",
      diffLines: 12,
      filesChanged: 2,
      changedPaths: ["reports/holdout.json"],
      withinBudget: true,
      operators: [],
    },
    artifacts: [],
    metrics: {},
    constraints: [],
    logs: {},
    ...overrides,
  };
}
