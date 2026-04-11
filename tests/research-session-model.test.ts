import { describe, expect, it } from "vitest";

import {
  buildResearchSessionTuiSelectedCandidateSummary,
  researchSessionRecordSchema,
  researchSessionTuiSelectedCandidateSummarySchema,
  type ResearchSessionRecord,
} from "../src/core/model/research-session.js";

function makeSession(overrides: Partial<ResearchSessionRecord> = {}): ResearchSessionRecord {
  return {
    sessionId: "session-001",
    goal: "Reach 70% holdout top-3 prediction success.",
    workingDirectory: "/tmp/demo",
    status: "running",
    agent: {
      type: "codex_cli",
      command: "codex",
    },
    workspace: {
      strategy: "git_worktree",
      currentRef: "refs/heads/session-001",
      currentPath: "/tmp/demo/.ralph/sessions/session-001/worktree",
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
  };
}

describe("researchSessionRecordSchema", () => {
  it("accepts draft sessions as resumable launch checkpoints", () => {
    const parsed = researchSessionRecordSchema.parse({
      sessionId: "launch-draft",
      goal: "Finish the horse-racing demo.",
      workingDirectory: "/tmp/demo",
      status: "draft",
      draftState: {
        currentStep: "permissions",
        flowState: {
          permissions: {
            workingDirectory: "/tmp/demo",
            webSearch: "enabled",
            shellCommandAllowlistAdditions: "git status",
            shellCommandAllowlistRemovals: "rm",
            approvalPolicy: "never",
            sandboxMode: "workspace-write",
          },
          stopRules: {
            repeatedFailures: "0",
            noMeaningfulProgress: "abc",
            insufficientEvidence: "-1",
          },
          outputs: {
            goal: "  ",
            trackableGlobs: "**/*.ts, **/*.md",
            baseRef: "HEAD",
            agentCommand: "codex --model gpt-5.4",
            model: "",
            startupTimeoutSec: "30",
            turnTimeoutSec: "900",
          },
        },
        goalStep: {
          goal: "  ",
          agentCommand: "codex --model gpt-5.4",
          repeatedFailures: "0",
          noMeaningfulProgress: "abc",
          insufficientEvidence: "-1",
        },
        contextStep: {
          trackableGlobs: "**/*.ts, **/*.md",
          webSearch: "enabled",
          shellCommandAllowlistAdditions: "git status",
          shellCommandAllowlistRemovals: "rm",
        },
        agentStep: {
          command: "codex --model gpt-5.4",
          model: "",
          approvalPolicy: "never",
          sandboxMode: "workspace-write",
          startupTimeoutSec: "30",
          turnTimeoutSec: "900",
        },
      },
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:00.000Z",
    });

    expect(parsed.status).toBe("draft");
    expect(parsed.resume.resumeFromCycle).toBe(1);
    expect(parsed.stopCondition.type).toBe("none");
    expect(parsed.draftState?.flowState?.permissions?.approvalPolicy).toBe("never");
    expect(parsed.draftState?.flowState?.stopRules?.repeatedFailures).toBe("0");
    expect(parsed.draftState?.flowState?.outputs?.goal).toBe("  ");
    expect(parsed.draftState?.goalStep.goal).toBe("  ");
    expect(parsed.draftState?.goalStep.repeatedFailures).toBe("0");
    expect(parsed.draftState?.contextStep?.trackableGlobs).toBe("**/*.ts, **/*.md");
    expect(parsed.draftState?.agentStep.command).toBe("codex --model gpt-5.4");
    expect(parsed.draftState?.reviewConfirmed).toBe(false);
    expect(parsed.context.webSearch).toBe(true);
    expect(parsed.agent.ttySession.turnTimeoutSec).toBe(900);
  });

  it("applies default stop thresholds for a fresh running session", () => {
    const parsed = researchSessionRecordSchema.parse({
      sessionId: "session-001",
      goal: "Finish the horse-racing demo.",
      workingDirectory: "/tmp/demo",
      status: "running",
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:00.000Z",
    });

    expect(parsed.stopPolicy).toEqual({
      repeatedFailures: 3,
      noMeaningfulProgress: 5,
      insufficientEvidence: 3,
    });
    expect(parsed.progress.nextCycle).toBe(1);
    expect(parsed.resume.resumeFromCycle).toBe(1);
    expect(parsed.context.trackableGlobs).toEqual(["**/*.md", "**/*.txt", "**/*.py", "**/*.ts", "**/*.tsx"]);
    expect(parsed.context.webSearch).toBe(true);
    expect(parsed.workspace.strategy).toBe("git_worktree");
  });

  it("requires evidence and a terminal timestamp for goal_achieved sessions", () => {
    const result = researchSessionRecordSchema.safeParse(
      makeSession({
        status: "goal_achieved",
        stopCondition: {
          type: "goal_achieved",
          summary: "Holdout verifier crossed the target.",
          achievedAtCycle: 7,
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["evidenceBundlePath"],
        }),
        expect.objectContaining({
          path: ["endedAt"],
        }),
      ]),
    );
  });

  it("rejects resume pointers that skip the completed cycle boundary", () => {
    const result = researchSessionRecordSchema.safeParse(
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
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 3,
            diffLineCount: 41,
            meaningfulProgress: true,
            reasons: ["Created a new holdout report."],
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 4,
          requiresUserConfirmation: false,
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["resume", "resumeFromCycle"],
        }),
      ]),
    );
  });

  it("requires resume checkpoint ids to match the latest completed cycle record ids", () => {
    const result = researchSessionRecordSchema.safeParse(
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
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 3,
            diffLineCount: 41,
            meaningfulProgress: true,
            reasons: ["Created a new holdout report."],
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: true,
          checkpointRunId: "run-001",
          checkpointDecisionId: "decision-001",
          interruptionDetectedAt: "2026-04-12T00:10:00.000Z",
          interruptedDuringCycle: 3,
        },
        status: "awaiting_resume",
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["resume", "checkpointRunId"],
        }),
        expect.objectContaining({
          path: ["resume", "checkpointDecisionId"],
        }),
      ]),
    );
  });

  it("requires checkpoint metadata for any session that has completed at least one cycle", () => {
    const result = researchSessionRecordSchema.safeParse(
      makeSession({
        status: "awaiting_resume",
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestFrontierIds: ["frontier-001"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 2,
          requiresUserConfirmation: true,
          interruptionDetectedAt: "2026-04-12T00:10:00.000Z",
          interruptedDuringCycle: 2,
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["progress", "latestRunId"],
        }),
        expect.objectContaining({
          path: ["progress", "lastCheckpointAt"],
        }),
        expect.objectContaining({
          path: ["progress", "lastSignals"],
        }),
        expect.objectContaining({
          path: ["resume", "checkpointRunId"],
        }),
      ]),
    );
  });

  it("requires halted sessions to capture a resumable stop reason", () => {
    const result = researchSessionRecordSchema.safeParse(
      makeSession({
        status: "halted",
        stopCondition: {
          type: "none",
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 2,
          requiresUserConfirmation: false,
        },
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-001",
          latestDecisionId: "decision-001",
          latestFrontierIds: [],
          repeatedFailureStreak: 3,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastSignals: {
            cycle: 1,
            outcome: "failed",
            changedFileCount: 0,
            diffLineCount: 0,
            meaningfulProgress: false,
            reasons: ["Verification failed three times in a row."],
          },
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["resume", "requiresUserConfirmation"],
        }),
        expect.objectContaining({
          path: ["stopCondition"],
        }),
      ]),
    );
  });

  it("requires a full promotion audit trail before marking a workspace as promoted", () => {
    const result = researchSessionRecordSchema.safeParse(
      makeSession({
        status: "goal_achieved",
        evidenceBundlePath: ".ralph/sessions/session-001/evidence",
        endedAt: "2026-04-12T00:30:00.000Z",
        stopCondition: {
          type: "goal_achieved",
          summary: "Holdout verifier crossed the target.",
          achievedAtCycle: 2,
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
          lastCheckpointAt: "2026-04-12T00:29:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 4,
            diffLineCount: 52,
            meaningfulProgress: true,
            reasons: ["Created the final verifier report."],
          },
        },
        resume: {
          resumable: false,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: false,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
        },
        workspace: {
          strategy: "git_worktree",
          currentRef: "refs/heads/session-001",
          currentPath: "/tmp/demo/.ralph/sessions/session-001/worktree",
          promoted: true,
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["workspace", "promotedAt"],
        }),
        expect.objectContaining({
          path: ["workspace", "promotedRunId"],
        }),
        expect.objectContaining({
          path: ["workspace", "promotedDecisionId"],
        }),
        expect.objectContaining({
          path: ["workspace", "promotedCommitSha"],
        }),
      ]),
    );
  });

  it("defines the TUI selected-candidate summary contract for resume-or-new decisions", () => {
    const summary = buildResearchSessionTuiSelectedCandidateSummary(
      makeSession({
        sessionId: "session-resume",
        status: "halted",
        updatedAt: "2026-04-12T00:10:00.000Z",
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-002"],
          repeatedFailureStreak: 1,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastCheckpointAt: "2026-04-12T00:09:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 2,
            diffLineCount: 21,
            meaningfulProgress: true,
            reasons: ["Checkpoint 2 persisted."],
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
          checkpointDecisionId: "decision-002",
        },
      }),
    );

    expect(summary).toEqual(
      researchSessionTuiSelectedCandidateSummarySchema.parse({
        sessionId: "session-resume",
        status: "halted",
        goal: "Reach 70% holdout top-3 prediction success.",
        updatedAt: "2026-04-12T00:10:00.000Z",
        resumeFromCycle: 3,
        checkpoint: {
          completedCycles: 2,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          lastCheckpointAt: "2026-04-12T00:09:00.000Z",
          stopCondition: "operator_stop",
        },
        latestCycle: {
          outcome: "accepted",
          meaningfulProgress: true,
          insufficientEvidence: false,
          changedFileCount: 2,
          diffLineCount: 21,
          newArtifactCount: 0,
        },
        userConfirmation: {
          required: true,
        },
      }),
    );
  });
});
