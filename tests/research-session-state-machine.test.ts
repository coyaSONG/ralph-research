import { describe, expect, it } from "vitest";

import type { DecisionRecord } from "../src/core/model/decision-record.js";
import { researchSessionRecordSchema, type ResearchSessionRecord } from "../src/core/model/research-session.js";
import type { RunRecord } from "../src/core/model/run-record.js";
import {
  advanceResearchSessionCompletedCycle,
  resumeResearchSession,
  startResearchSessionFromDraft,
} from "../src/core/state/research-session-state-machine.js";

describe("research-session-state-machine", () => {
  it("starts a new session from draft contract fields without hydrating prior runtime state", () => {
    const started = startResearchSessionFromDraft({
      draft: makeSession({
        sessionId: "launch-draft",
        status: "draft",
        goal: "Fresh session goal",
        workspace: {
          strategy: "git_worktree",
          baseRef: "origin/main",
          currentRef: "refs/heads/stale-candidate",
          currentPath: "/tmp/demo/.ralph/workspaces/stale-candidate",
          promoted: false,
        },
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-001", "frontier-002"],
          repeatedFailureStreak: 1,
          noMeaningfulProgressStreak: 2,
          insufficientEvidenceStreak: 1,
          lastMeaningfulProgressCycle: 2,
          lastCheckpointAt: "2026-04-12T00:04:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 3,
            diffLineCount: 21,
            repeatedDiff: false,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["Stale checkpoint metadata should not leak into a new session."],
            newArtifacts: ["reports/cycle-002.json"],
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: true,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          interruptionDetectedAt: "2026-04-12T00:04:30.000Z",
          interruptedDuringCycle: 3,
          note: "resume me",
        },
        draftState: {
          currentStep: "review",
          completedSteps: ["permissions", "stopRules", "outputs"],
          returnToReview: false,
          reviewConfirmed: true,
        },
      }),
      sessionId: "session-002",
      at: "2026-04-12T00:05:00.000Z",
    });

    expect(started).toMatchObject({
      sessionId: "session-002",
      status: "running",
      goal: "Fresh session goal",
      workspace: {
        strategy: "git_worktree",
        baseRef: "origin/main",
        promoted: false,
      },
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
        resumeFromCycle: 1,
        requiresUserConfirmation: false,
      },
      stopCondition: {
        type: "none",
      },
      createdAt: "2026-04-12T00:05:00.000Z",
      updatedAt: "2026-04-12T00:05:00.000Z",
    });
    expect(started.workspace.currentRef).toBeUndefined();
    expect(started.workspace.currentPath).toBeUndefined();
    expect(started.progress.latestRunId).toBeUndefined();
    expect(started.progress.latestDecisionId).toBeUndefined();
    expect(started.progress.lastCheckpointAt).toBeUndefined();
    expect(started.progress.lastSignals).toBeUndefined();
    expect(started.resume.checkpointRunId).toBeUndefined();
    expect(started.resume.checkpointDecisionId).toBeUndefined();
    expect(started.resume.interruptionDetectedAt).toBeUndefined();
    expect(started.resume.interruptedDuringCycle).toBeUndefined();
    expect(started.resume.note).toBeUndefined();
    expect(started.draftState).toEqual({
      currentStep: "review",
      completedSteps: ["permissions", "stopRules", "outputs"],
      returnToReview: false,
      reviewConfirmed: true,
    });
    expect(started.submittedSnapshot).toMatchObject({
      sessionId: "session-002",
      status: "running",
      goal: "Fresh session goal",
      workingDirectory: "/tmp/demo",
      workspace: {
        strategy: "git_worktree",
        baseRef: "origin/main",
        promoted: false,
      },
      progress: {
        completedCycles: 0,
        nextCycle: 1,
        latestFrontierIds: [],
      },
      resume: {
        resumable: true,
        resumeFromCycle: 1,
        requiresUserConfirmation: false,
      },
      draftState: {
        currentStep: "review",
        completedSteps: ["permissions", "stopRules", "outputs"],
        reviewConfirmed: true,
      },
      createdAt: "2026-04-12T00:05:00.000Z",
      updatedAt: "2026-04-12T00:05:00.000Z",
    });
    expect(started.submittedSnapshot?.workspace.currentRef).toBeUndefined();
    expect(started.submittedSnapshot?.workspace.currentPath).toBeUndefined();
    expect(started.submittedSnapshot?.progress.latestRunId).toBeUndefined();
    expect(started.submittedSnapshot?.resume.checkpointRunId).toBeUndefined();
    expect(started.endedAt).toBeUndefined();
  });

  it("preserves the submitted snapshot after later checkpoints mutate the live session", () => {
    const started = startResearchSessionFromDraft({
      draft: makeSession({
        sessionId: "launch-draft",
        status: "draft",
        goal: "Improve the horse-racing demo.",
        draftState: {
          currentStep: "review",
          completedSteps: ["permissions", "stopRules", "outputs", "review"],
          returnToReview: false,
          reviewConfirmed: true,
        },
      }),
      sessionId: "session-003",
      at: "2026-04-12T00:05:00.000Z",
    });

    const result = advanceResearchSessionCompletedCycle({
      current: started,
      run: makeRun({
        runId: "run-001",
        cycle: 1,
        status: "accepted",
        workspaceRef: "refs/heads/session-003",
        workspacePath: "/tmp/demo/.ralph/sessions/session-003/worktree",
      }),
      decision: makeDecision({
        decisionId: "decision-001",
        runId: "run-001",
        outcome: "accepted",
      }),
      frontierIds: ["frontier-001"],
      signal: {
        outcome: "accepted",
        changedFileCount: 2,
        diffLineCount: 17,
        repeatedDiff: false,
        meaningfulProgress: true,
        insufficientEvidence: false,
        agentTieBreakerUsed: false,
        verificationDelta: 0.1,
        reasons: ["Persisted the first completed cycle."],
        newArtifacts: ["reports/cycle-001.json"],
      },
      at: "2026-04-12T00:06:00.000Z",
    });

    expect(result.session.progress).toMatchObject({
      completedCycles: 1,
      nextCycle: 2,
      latestRunId: "run-001",
      latestDecisionId: "decision-001",
    });
    expect(result.session.workspace).toMatchObject({
      currentRef: "refs/heads/session-003",
      currentPath: "/tmp/demo/.ralph/sessions/session-003/worktree",
    });
    expect(result.session.submittedSnapshot).toMatchObject({
      sessionId: "session-003",
      status: "running",
      progress: {
        completedCycles: 0,
        nextCycle: 1,
        latestFrontierIds: [],
      },
      resume: {
        resumeFromCycle: 1,
      },
      createdAt: "2026-04-12T00:05:00.000Z",
      updatedAt: "2026-04-12T00:05:00.000Z",
    });
    expect(result.session.submittedSnapshot?.progress.latestRunId).toBeUndefined();
    expect(result.session.submittedSnapshot?.workspace.currentRef).toBeUndefined();
    expect(result.session.submittedSnapshot?.workspace.currentPath).toBeUndefined();
  });

  it("allows stale running sessions to restart from the last completed-cycle checkpoint", () => {
    const resumed = resumeResearchSession({
      current: makeSession({
        status: "running",
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-001",
          latestDecisionId: "decision-001",
          latestFrontierIds: ["frontier-001"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 1,
          lastCheckpointAt: "2026-04-12T00:04:00.000Z",
          lastSignals: {
            cycle: 1,
            outcome: "accepted",
            changedFileCount: 2,
            diffLineCount: 17,
            repeatedDiff: false,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["Checkpointed the last completed cycle."],
            newArtifacts: ["reports/cycle-001.json"],
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
      at: "2026-04-12T00:05:00.000Z",
    });

    expect(resumed).toMatchObject({
      status: "running",
      stopCondition: {
        type: "none",
      },
      progress: {
        completedCycles: 1,
        nextCycle: 2,
        latestRunId: "run-001",
        latestDecisionId: "decision-001",
      },
      resume: {
        resumeFromCycle: 2,
        checkpointRunId: "run-001",
        checkpointDecisionId: "decision-001",
        requiresUserConfirmation: false,
      },
      updatedAt: "2026-04-12T00:05:00.000Z",
    });
  });

  it("keeps the session running after a completed cycle when no stop threshold is hit", () => {
    const result = advanceResearchSessionCompletedCycle({
      current: makeSession(),
      run: makeRun({
        runId: "run-002",
        cycle: 1,
        status: "accepted",
      }),
      decision: makeDecision({
        decisionId: "decision-002",
        runId: "run-002",
        outcome: "accepted",
      }),
      frontierIds: ["frontier-002"],
      signal: {
        outcome: "accepted",
        changedFileCount: 2,
        diffLineCount: 17,
        repeatedDiff: false,
        meaningfulProgress: true,
        insufficientEvidence: false,
        agentTieBreakerUsed: false,
        verificationDelta: 0.09,
        reasons: ["Wrote a new holdout report."],
        newArtifacts: ["reports/cycle-001.json"],
      },
      at: "2026-04-12T00:05:00.000Z",
    });

    expect(result).toMatchObject({
      transition: "cycle_checkpointed",
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
        },
        resume: {
          resumeFromCycle: 2,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          requiresUserConfirmation: false,
        },
      },
    });
  });

  it("advances the completed-cycle checkpoint by clearing stale interruption metadata and preserving the last meaningful cycle", () => {
    const result = advanceResearchSessionCompletedCycle({
      current: makeSession({
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-002"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 1,
          insufficientEvidenceStreak: 1,
          lastMeaningfulProgressCycle: 2,
          lastCheckpointAt: "2026-04-12T00:04:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 2,
            diffLineCount: 17,
            repeatedDiff: false,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["Checkpointed the last meaningful cycle."],
            newArtifacts: ["reports/cycle-002.json"],
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: false,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          interruptionDetectedAt: "2026-04-12T00:04:30.000Z",
          interruptedDuringCycle: 3,
          note: "TTY disconnected while cycle 3 was starting.",
        },
      }),
      run: makeRun({
        runId: "run-003",
        cycle: 3,
        status: "rejected",
      }),
      decision: null,
      frontierIds: ["frontier-002", "frontier-002"],
      signal: {
        outcome: "rejected",
        changedFileCount: 0,
        diffLineCount: 0,
        repeatedDiff: true,
        meaningfulProgress: false,
        insufficientEvidence: true,
        agentTieBreakerUsed: false,
        reasons: ["The cycle produced no new reproducible evidence."],
        newArtifacts: [],
      },
      at: "2026-04-12T00:05:00.000Z",
    });

    expect(result).toMatchObject({
      transition: "cycle_checkpointed",
      session: {
        status: "running",
        progress: {
          completedCycles: 3,
          nextCycle: 4,
          latestRunId: "run-003",
          latestFrontierIds: ["frontier-002"],
          noMeaningfulProgressStreak: 2,
          insufficientEvidenceStreak: 2,
          lastMeaningfulProgressCycle: 2,
        },
        resume: {
          resumeFromCycle: 4,
          checkpointRunId: "run-003",
          requiresUserConfirmation: false,
        },
      },
    });
    expect(result.session.progress.latestDecisionId).toBeUndefined();
    expect(result.session.resume.checkpointDecisionId).toBeUndefined();
    expect(result.session.resume.interruptionDetectedAt).toBeUndefined();
    expect(result.session.resume.interruptedDuringCycle).toBeUndefined();
    expect(result.session.resume.note).toBeUndefined();
  });

  it("halts at the same completed-cycle boundary when a stop threshold is reached", () => {
    const result = advanceResearchSessionCompletedCycle({
      current: makeSession({
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
          lastCheckpointAt: "2026-04-12T00:04:00.000Z",
          lastSignals: {
            cycle: 1,
            outcome: "failed",
            changedFileCount: 0,
            diffLineCount: 0,
            repeatedDiff: false,
            meaningfulProgress: false,
            insufficientEvidence: true,
            agentTieBreakerUsed: false,
            reasons: ["Previous cycle produced no durable evidence."],
            newArtifacts: [],
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
      run: makeRun({
        runId: "run-002",
        cycle: 2,
        status: "failed",
        phase: "failed",
        pendingAction: "none",
        endedAt: "2026-04-12T00:05:00.000Z",
        error: {
          message: "verification failed",
        },
      }),
      decision: null,
      frontierIds: ["frontier-001"],
      signal: {
        outcome: "failed",
        changedFileCount: 0,
        diffLineCount: 0,
        repeatedDiff: true,
        meaningfulProgress: false,
        insufficientEvidence: true,
        agentTieBreakerUsed: false,
        reasons: ["The verifier still failed."],
        newArtifacts: [],
      },
      at: "2026-04-12T00:06:00.000Z",
    });

    expect(result).toMatchObject({
      transition: "session_halted",
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
          latestRunId: "run-002",
          latestFrontierIds: ["frontier-001"],
          repeatedFailureStreak: 3,
        },
        resume: {
          resumeFromCycle: 3,
          checkpointRunId: "run-002",
          requiresUserConfirmation: true,
        },
      },
    });
  });

  it("halts for operator review at the completed-cycle boundary while preserving the next resume checkpoint", () => {
    const result = advanceResearchSessionCompletedCycle({
      current: makeSession(),
      run: makeRun({
        runId: "run-003",
        cycle: 1,
        status: "needs_human",
      }),
      decision: makeDecision({
        decisionId: "decision-003",
        runId: "run-003",
        outcome: "needs_human",
      }),
      frontierIds: [],
      signal: {
        outcome: "needs_human",
        changedFileCount: 2,
        diffLineCount: 11,
        repeatedDiff: false,
        meaningfulProgress: true,
        insufficientEvidence: false,
        agentTieBreakerUsed: false,
        reasons: ["Produced a candidate that needs review."],
        newArtifacts: ["reports/manual-review.json"],
      },
      at: "2026-04-12T00:05:00.000Z",
    });

    expect(result).toMatchObject({
      transition: "session_halted",
      session: {
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
        },
        resume: {
          resumeFromCycle: 2,
          checkpointRunId: "run-003",
          checkpointDecisionId: "decision-003",
          requiresUserConfirmation: true,
        },
      },
    });
  });
});

function makeSession(overrides: Partial<ResearchSessionRecord> = {}): ResearchSessionRecord {
  return researchSessionRecordSchema.parse({
    sessionId: "session-001",
    goal: "Reach the holdout target.",
    workingDirectory: "/tmp/demo",
    status: "running",
    agent: {
      type: "codex_cli",
      command: "codex",
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

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
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

function makeDecision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    decisionId: "decision-001",
    runId: "run-001",
    outcome: "accepted",
    actorType: "system",
    policyType: "ratchet",
    reason: "metric improved",
    createdAt: "2026-04-12T00:01:00.000Z",
    frontierChanged: true,
    beforeFrontierIds: [],
    afterFrontierIds: ["frontier-001"],
    auditRequired: false,
    ...overrides,
  };
}
