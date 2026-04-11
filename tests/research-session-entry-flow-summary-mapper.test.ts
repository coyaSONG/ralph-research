import { describe, expect, it } from "vitest";

import { mapDetectedResearchSessionToEntryFlowSummary } from "../src/app/services/research-session-entry-flow-summary-mapper.js";
import type { ResearchSessionRecoveryInspection } from "../src/app/services/research-session-recovery-service.js";
import { type CodexCliSessionLifecycleRecord } from "../src/core/model/codex-cli-session-lifecycle.js";
import { researchSessionRecordSchema, type ResearchSessionRecord } from "../src/core/model/research-session.js";

describe("mapDetectedResearchSessionToEntryFlowSummary", () => {
  it("maps a running session inspection into the resume entry-flow summary and bundle", () => {
    const session = makeSession({
      sessionId: "session-running-001",
      status: "running",
      updatedAt: "2026-04-12T00:08:30.000Z",
      progress: {
        completedCycles: 3,
        nextCycle: 4,
        latestRunId: "run-003",
        latestDecisionId: "decision-003",
        latestFrontierIds: ["frontier-003"],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
        lastCheckpointAt: "2026-04-12T00:08:00.000Z",
        lastSignals: {
          cycle: 3,
          outcome: "accepted",
          changedFileCount: 4,
          diffLineCount: 35,
          repeatedDiff: false,
          meaningfulProgress: true,
          insufficientEvidence: false,
          agentTieBreakerUsed: false,
          newArtifacts: ["reports/holdout-003.json", "reports/summary-003.md"],
          agentSummary: "Holdout verification improved after cycle 3.",
          reasons: ["Checkpoint 3 persisted before the next cycle."],
        },
      },
      stopCondition: {
        type: "none",
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 4,
        requiresUserConfirmation: false,
        checkpointRunId: "run-003",
        checkpointDecisionId: "decision-003",
      },
    });
    const lifecycle = makeLifecycle({
      sessionId: session.sessionId,
      workingDirectory: session.workingDirectory,
      goal: session.goal,
      resumeFromCycle: 4,
      completedCycles: 3,
      updatedAt: "2026-04-12T00:08:30.000Z",
      phase: "running",
      pid: 5151,
      references: {
        checkpointRunId: "run-003",
        checkpointDecisionId: "decision-003",
      },
    });
    const inspection: ResearchSessionRecoveryInspection = {
      session,
      lifecycle,
      codexSessionReference: {
        codexSessionId: "codex-session-running-001",
        lifecyclePath: "/repo/.ralph/sessions/session-running-001/codex-session.json",
      },
      recovery: {
        classification: "resumable",
        resumeAllowed: true,
        reason: "running Codex lifecycle can continue from checkpoint 3",
        runtime: {
          state: "active",
          processAlive: true,
          stale: false,
          phase: "running",
        },
      },
    };

    expect(mapDetectedResearchSessionToEntryFlowSummary(inspection)).toEqual({
      selectedCandidateSummary: {
        sessionId: "session-running-001",
        status: "running",
        goal: "Reach 70% holdout top-3 prediction success.",
        updatedAt: "2026-04-12T00:08:30.000Z",
        resumeFromCycle: 4,
        checkpoint: {
          completedCycles: 3,
          latestRunId: "run-003",
          latestDecisionId: "decision-003",
          lastCheckpointAt: "2026-04-12T00:08:00.000Z",
          stopCondition: "none",
        },
        latestCycle: {
          outcome: "accepted",
          meaningfulProgress: true,
          insufficientEvidence: false,
          changedFileCount: 4,
          diffLineCount: 35,
          newArtifactCount: 2,
          agentSummary: "Holdout verification improved after cycle 3.",
        },
        recovery: {
          classification: "resumable",
          resumeAllowed: true,
          reason: "running Codex lifecycle can continue from checkpoint 3",
          runtimeState: "active",
          codexPhase: "running",
        },
        userConfirmation: {
          required: true,
        },
      },
      resumableSession: {
        sessionId: "session-running-001",
        persistedState: {
          session,
          lifecycle,
          codexSessionReference: {
            codexSessionId: "codex-session-running-001",
            lifecyclePath: "/repo/.ralph/sessions/session-running-001/codex-session.json",
          },
        },
      },
    });
  });

  it("maps a halted session inspection into summary-only output when resume is blocked", () => {
    const session = makeSession({
      sessionId: "session-halted-001",
      status: "halted",
      updatedAt: "2026-04-12T00:11:30.000Z",
      progress: {
        completedCycles: 4,
        nextCycle: 5,
        latestRunId: "run-004",
        latestDecisionId: "decision-004",
        latestFrontierIds: ["frontier-004"],
        repeatedFailureStreak: 3,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
        lastCheckpointAt: "2026-04-12T00:11:00.000Z",
        lastSignals: {
          cycle: 4,
          outcome: "failed",
          changedFileCount: 1,
          diffLineCount: 11,
          repeatedDiff: false,
          meaningfulProgress: false,
          insufficientEvidence: true,
          agentTieBreakerUsed: false,
          newArtifacts: [],
          reasons: ["Checkpoint 4 persisted before the halt."],
        },
      },
      stopCondition: {
        type: "repeated_failures",
        count: 3,
        threshold: 3,
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 5,
        requiresUserConfirmation: true,
        checkpointRunId: "run-004",
        checkpointDecisionId: "decision-004",
      },
    });
    const inspection: ResearchSessionRecoveryInspection = {
      session,
      lifecycle: null,
      codexSessionReference: null,
      recovery: {
        classification: "inspect_only",
        resumeAllowed: false,
        reason: "Codex CLI still appears to be running for this halted session",
        runtime: {
          state: "missing",
          processAlive: false,
          stale: false,
        },
      },
    };

    expect(mapDetectedResearchSessionToEntryFlowSummary(inspection)).toEqual({
      selectedCandidateSummary: {
        sessionId: "session-halted-001",
        status: "halted",
        goal: "Reach 70% holdout top-3 prediction success.",
        updatedAt: "2026-04-12T00:11:30.000Z",
        resumeFromCycle: 5,
        checkpoint: {
          completedCycles: 4,
          latestRunId: "run-004",
          latestDecisionId: "decision-004",
          lastCheckpointAt: "2026-04-12T00:11:00.000Z",
          stopCondition: "repeated_failures",
        },
        latestCycle: {
          outcome: "failed",
          meaningfulProgress: false,
          insufficientEvidence: true,
          changedFileCount: 1,
          diffLineCount: 11,
          newArtifactCount: 0,
        },
        recovery: {
          classification: "inspect_only",
          resumeAllowed: false,
          reason: "Codex CLI still appears to be running for this halted session",
          runtimeState: "missing",
        },
        userConfirmation: {
          required: true,
        },
      },
    });
  });

  it("rejects unsupported statuses so the entry flow stays narrowed to running and halted detections", () => {
    const inspection: ResearchSessionRecoveryInspection = {
      session: makeSession({
        sessionId: "session-awaiting-001",
        status: "awaiting_resume",
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-001",
          latestDecisionId: "decision-001",
          latestFrontierIds: ["frontier-001"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastCheckpointAt: "2026-04-12T00:02:00.000Z",
          lastSignals: {
            cycle: 1,
            outcome: "accepted",
            changedFileCount: 1,
            diffLineCount: 8,
            repeatedDiff: false,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            newArtifacts: ["reports/cycle-001.json"],
            reasons: ["Checkpoint 1 persisted before the interruption."],
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 2,
          requiresUserConfirmation: true,
          checkpointRunId: "run-001",
          checkpointDecisionId: "decision-001",
          interruptionDetectedAt: "2026-04-12T00:02:30.000Z",
          interruptedDuringCycle: 2,
        },
      }),
      lifecycle: null,
      codexSessionReference: null,
      recovery: {
        classification: "resumable",
        resumeAllowed: true,
        reason: "awaiting_resume fixture",
        runtime: {
          state: "exited",
          processAlive: false,
          stale: false,
        },
      },
    };

    expect(() => mapDetectedResearchSessionToEntryFlowSummary(inspection)).toThrow(
      "Entry-flow summary only supports detected running or halted sessions; received awaiting_resume",
    );
  });
});

function makeSession(overrides: Partial<ResearchSessionRecord> = {}): ResearchSessionRecord {
  const {
    agent: agentOverrides,
    workspace: workspaceOverrides,
    stopPolicy: stopPolicyOverrides,
    progress: progressOverrides,
    stopCondition: stopConditionOverrides,
    resume: resumeOverrides,
    ...recordOverrides
  } = overrides;
  const completedCycles = progressOverrides?.completedCycles ?? 1;
  const nextCycle = progressOverrides?.nextCycle ?? completedCycles + 1;
  const latestRunId = progressOverrides?.latestRunId ?? `run-${String(completedCycles).padStart(3, "0")}`;
  const latestDecisionId =
    progressOverrides?.latestDecisionId ?? `decision-${String(completedCycles).padStart(3, "0")}`;
  const status = recordOverrides.status ?? "running";

  return researchSessionRecordSchema.parse({
    sessionId: "session-001",
    goal: "Reach 70% holdout top-3 prediction success.",
    workingDirectory: "/repo",
    status,
    agent: {
      type: "codex_cli",
      command: "codex",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      ttySession: {
        startupTimeoutSec: 30,
        turnTimeoutSec: 900,
      },
      ...agentOverrides,
    },
    workspace: {
      strategy: "git_worktree",
      promoted: false,
      ...workspaceOverrides,
    },
    stopPolicy: {
      repeatedFailures: 3,
      noMeaningfulProgress: 5,
      insufficientEvidence: 3,
      ...stopPolicyOverrides,
    },
    progress: {
      completedCycles,
      nextCycle,
      latestRunId,
      latestDecisionId,
      latestFrontierIds: [],
      repeatedFailureStreak: 0,
      noMeaningfulProgressStreak: 0,
      insufficientEvidenceStreak: 0,
      ...progressOverrides,
    },
    stopCondition: stopConditionOverrides ??
      (status === "halted"
        ? {
            type: "operator_stop",
          }
        : {
            type: "none",
          }),
    resume: {
      resumable: true,
      checkpointType: "completed_cycle_boundary",
      resumeFromCycle: nextCycle,
      requiresUserConfirmation: status !== "running",
      checkpointRunId: latestRunId,
      checkpointDecisionId: latestDecisionId,
      ...resumeOverrides,
    },
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:00:00.000Z",
    ...recordOverrides,
  });
}

function makeLifecycle(
  overrides: Partial<CodexCliSessionLifecycleRecord> = {},
): CodexCliSessionLifecycleRecord {
  return {
    sessionId: "session-001",
    workingDirectory: "/repo",
    goal: "Reach 70% holdout top-3 prediction success.",
    resumeFromCycle: 2,
    completedCycles: 1,
    command: "codex",
    args: ["continue"],
    approvalPolicy: "never",
    sandboxMode: "workspace-write",
    startedAt: "2026-04-12T00:01:00.000Z",
    updatedAt: "2026-04-12T00:02:00.000Z",
    phase: "running",
    identity: {
      researchSessionId: overrides.sessionId ?? "session-001",
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
      status: "bound",
      workingDirectory: overrides.workingDirectory ?? "/repo",
      trackedGlobs: ["reports/**/*.json", "src/**/*.ts"],
      attachedPaths: [],
      extraWritableDirectories: [overrides.workingDirectory ?? "/repo"],
    },
    references: {
      checkpointRunId: "run-001",
      ...(overrides.completedCycles && overrides.completedCycles > 0
        ? { checkpointDecisionId: "decision-001" }
        : {}),
    },
    ...overrides,
  };
}
