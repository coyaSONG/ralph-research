import { describe, expect, it } from "vitest";

import { selectResearchSessionResumeCandidate } from "../src/core/state/research-session-resume-candidate.js";
import {
  buildResearchSessionMetadata,
  researchSessionRecordSchema,
  type ResearchSessionRecord,
} from "../src/core/model/research-session.js";

describe("selectResearchSessionResumeCandidate", () => {
  it("prefers exact goal matches over newer sessions for other goals", () => {
    const selected = selectResearchSessionResumeCandidate({
      goal: "Reach 70% future holdout top-3 prediction success.",
      sessions: [
        makeSession({
          sessionId: "session-other-goal",
          goal: "Ship the MCP transport.",
          status: "halted",
          progress: {
            completedCycles: 8,
            nextCycle: 9,
            latestFrontierIds: [],
            repeatedFailureStreak: 0,
            noMeaningfulProgressStreak: 0,
            insufficientEvidenceStreak: 0,
            lastCheckpointAt: "2026-04-12T00:09:00.000Z",
          },
          updatedAt: "2026-04-12T00:10:00.000Z",
        }),
        makeSession({
          sessionId: "session-goal-match",
          status: "halted",
          progress: {
            completedCycles: 2,
            nextCycle: 3,
            latestFrontierIds: [],
            repeatedFailureStreak: 0,
            noMeaningfulProgressStreak: 0,
            insufficientEvidenceStreak: 0,
            lastCheckpointAt: "2026-04-12T00:04:00.000Z",
          },
          updatedAt: "2026-04-12T00:05:00.000Z",
        }),
      ],
    });

    expect(selected?.sessionId).toBe("session-goal-match");
  });

  it("prefers halted goal matches over running goal matches before comparing recency", () => {
    const selected = selectResearchSessionResumeCandidate({
      goal: "Reach 70% future holdout top-3 prediction success.",
      sessions: [
        makeSession({
          sessionId: "session-running",
          status: "running",
          progress: {
            completedCycles: 6,
            nextCycle: 7,
            latestFrontierIds: [],
            repeatedFailureStreak: 0,
            noMeaningfulProgressStreak: 0,
            insufficientEvidenceStreak: 0,
            lastCheckpointAt: "2026-04-12T00:10:00.000Z",
          },
          updatedAt: "2026-04-12T00:10:30.000Z",
        }),
        makeSession({
          sessionId: "session-halted",
          status: "halted",
          progress: {
            completedCycles: 4,
            nextCycle: 5,
            latestFrontierIds: [],
            repeatedFailureStreak: 0,
            noMeaningfulProgressStreak: 0,
            insufficientEvidenceStreak: 0,
            lastCheckpointAt: "2026-04-12T00:09:00.000Z",
          },
          updatedAt: "2026-04-12T00:09:30.000Z",
        }),
      ],
    });

    expect(selected?.sessionId).toBe("session-halted");
  });

  it("breaks ties by completed cycles, checkpoint time, update time, then session id", () => {
    const selected = selectResearchSessionResumeCandidate({
      goal: "Reach 70% future holdout top-3 prediction success.",
      sessions: [
        makeSession({
          sessionId: "session-001",
          status: "halted",
          progress: {
            completedCycles: 5,
            nextCycle: 6,
            latestFrontierIds: [],
            repeatedFailureStreak: 0,
            noMeaningfulProgressStreak: 0,
            insufficientEvidenceStreak: 0,
            lastCheckpointAt: "2026-04-12T00:08:00.000Z",
          },
          updatedAt: "2026-04-12T00:08:30.000Z",
          createdAt: "2026-04-12T00:00:00.000Z",
        }),
        makeSession({
          sessionId: "session-002",
          status: "halted",
          progress: {
            completedCycles: 5,
            nextCycle: 6,
            latestFrontierIds: [],
            repeatedFailureStreak: 0,
            noMeaningfulProgressStreak: 0,
            insufficientEvidenceStreak: 0,
            lastCheckpointAt: "2026-04-12T00:08:00.000Z",
          },
          updatedAt: "2026-04-12T00:08:30.000Z",
          createdAt: "2026-04-12T00:00:00.000Z",
        }),
        makeSession({
          sessionId: "session-003",
          status: "halted",
          progress: {
            completedCycles: 5,
            nextCycle: 6,
            latestFrontierIds: [],
            repeatedFailureStreak: 0,
            noMeaningfulProgressStreak: 0,
            insufficientEvidenceStreak: 0,
            lastCheckpointAt: "2026-04-12T00:09:00.000Z",
          },
          updatedAt: "2026-04-12T00:09:30.000Z",
          createdAt: "2026-04-12T00:00:00.000Z",
        }),
        makeSession({
          sessionId: "session-004",
          status: "halted",
          progress: {
            completedCycles: 6,
            nextCycle: 7,
            latestFrontierIds: [],
            repeatedFailureStreak: 0,
            noMeaningfulProgressStreak: 0,
            insufficientEvidenceStreak: 0,
            lastCheckpointAt: "2026-04-12T00:07:00.000Z",
          },
          updatedAt: "2026-04-12T00:07:30.000Z",
          createdAt: "2026-04-12T00:00:00.000Z",
        }),
      ],
    });

    expect(selected?.sessionId).toBe("session-004");
  });

  it("selects candidates from persisted startup metadata without requiring full session records", () => {
    const selected = selectResearchSessionResumeCandidate({
      goal: "Reach 70% future holdout top-3 prediction success.",
      sessions: [
        buildResearchSessionMetadata(
          makeSession({
            sessionId: "session-running-metadata",
            status: "running",
            progress: {
              completedCycles: 6,
              nextCycle: 7,
              latestFrontierIds: [],
              repeatedFailureStreak: 0,
              noMeaningfulProgressStreak: 0,
              insufficientEvidenceStreak: 0,
              lastCheckpointAt: "2026-04-12T00:10:00.000Z",
            },
            updatedAt: "2026-04-12T00:10:30.000Z",
          }),
        ),
        buildResearchSessionMetadata(
          makeSession({
            sessionId: "session-halted-metadata",
            status: "halted",
            progress: {
              completedCycles: 4,
              nextCycle: 5,
              latestFrontierIds: [],
              repeatedFailureStreak: 0,
              noMeaningfulProgressStreak: 0,
              insufficientEvidenceStreak: 0,
              lastCheckpointAt: "2026-04-12T00:09:00.000Z",
            },
            updatedAt: "2026-04-12T00:09:30.000Z",
          }),
        ),
      ],
    });

    expect(selected?.sessionId).toBe("session-halted-metadata");
    expect(selected?.resumeFromCycle).toBe(5);
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
  const completedCycles = progressOverrides?.completedCycles ?? 0;
  const nextCycle = progressOverrides?.nextCycle ?? completedCycles + 1;
  const latestRunId = progressOverrides?.latestRunId ?? (completedCycles > 0 ? `run-${completedCycles}` : undefined);
  const latestDecisionId =
    progressOverrides?.latestDecisionId ?? (completedCycles > 0 ? `decision-${completedCycles}` : undefined);
  const lastCheckpointAt =
    progressOverrides?.lastCheckpointAt ??
    (completedCycles > 0 ? `2026-04-12T00:${String(Math.min(completedCycles, 59)).padStart(2, "0")}:00.000Z` : undefined);
  const lastSignals =
    progressOverrides?.lastSignals ??
    (completedCycles > 0
      ? {
          cycle: completedCycles,
          outcome: "accepted" as const,
          changedFileCount: 1,
          diffLineCount: 10,
          repeatedDiff: false,
          meaningfulProgress: true,
          insufficientEvidence: false,
          agentTieBreakerUsed: false,
          newArtifacts: [`reports/cycle-${completedCycles}.json`],
          reasons: [`Checkpoint ${completedCycles} persisted.`],
        }
      : undefined);
  const status = recordOverrides.status ?? "running";

  return researchSessionRecordSchema.parse({
    sessionId: "session-001",
    goal: "Reach 70% future holdout top-3 prediction success.",
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
      ...(latestRunId ? { latestRunId } : {}),
      ...(latestDecisionId ? { latestDecisionId } : {}),
      latestFrontierIds: [],
      repeatedFailureStreak: 0,
      noMeaningfulProgressStreak: 0,
      insufficientEvidenceStreak: 0,
      ...(lastCheckpointAt ? { lastCheckpointAt } : {}),
      ...(lastSignals ? { lastSignals } : {}),
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
      requiresUserConfirmation: status === "halted",
      ...(latestRunId ? { checkpointRunId: latestRunId } : {}),
      ...(latestDecisionId ? { checkpointDecisionId: latestDecisionId } : {}),
      ...resumeOverrides,
    },
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:00:00.000Z",
    ...recordOverrides,
  });
}
