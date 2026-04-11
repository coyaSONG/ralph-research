import type { DecisionRecord } from "../model/decision-record.js";
import {
  isResumableResearchSessionStatus,
  researchSessionRecordSchema,
  type ResearchSessionProgressSignal,
  type ResearchSessionRecord,
  type ResearchSessionStopCondition,
} from "../model/research-session.js";
import type { RunRecord } from "../model/run-record.js";

export interface AdvanceResearchSessionCompletedCycleInput {
  current: ResearchSessionRecord;
  run: RunRecord;
  decision: DecisionRecord | null;
  frontierIds: string[];
  signal: Omit<ResearchSessionProgressSignal, "cycle">;
  at: string;
}

export interface AdvanceResearchSessionCompletedCycleResult {
  transition: "cycle_checkpointed" | "session_halted";
  session: ResearchSessionRecord;
}

export function startResearchSessionFromDraft(input: {
  draft: ResearchSessionRecord;
  sessionId: string;
  at: string;
}): ResearchSessionRecord {
  if (input.draft.status !== "draft") {
    throw new Error(`Session ${input.draft.sessionId} is not a launch draft`);
  }

  const started = researchSessionRecordSchema.parse({
    sessionId: normalizeRequiredString(input.sessionId, "Session id"),
    goal: input.draft.goal,
    workingDirectory: input.draft.workingDirectory,
    status: "running",
    agent: {
      ...input.draft.agent,
      ttySession: {
        ...input.draft.agent.ttySession,
      },
    },
    context: {
      trackableGlobs: [...input.draft.context.trackableGlobs],
      webSearch: input.draft.context.webSearch,
      shellCommandAllowlistAdditions: [...input.draft.context.shellCommandAllowlistAdditions],
      shellCommandAllowlistRemovals: [...input.draft.context.shellCommandAllowlistRemovals],
    },
    workspace: {
      strategy: "git_worktree",
      ...(input.draft.workspace.baseRef ? { baseRef: input.draft.workspace.baseRef } : {}),
      promoted: false,
    },
    stopPolicy: {
      ...input.draft.stopPolicy,
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
    ...(input.draft.draftState
      ? {
          draftState: cloneResearchSessionDraftState(input.draft.draftState),
        }
      : {}),
    createdAt: input.at,
    updatedAt: input.at,
  });

  return researchSessionRecordSchema.parse({
    ...started,
    submittedSnapshot: createResearchSessionSubmittedSnapshot(started),
  });
}

export function resumeResearchSession(input: {
  current: ResearchSessionRecord;
  at: string;
}): ResearchSessionRecord {
  if (!isResumableResearchSessionStatus(input.current.status)) {
    throw new Error(
      `Session ${input.current.sessionId} cannot resume from status ${input.current.status}`,
    );
  }

  const nextRecord = researchSessionRecordSchema.parse({
    ...input.current,
    status: "running",
    stopCondition: {
      type: "none",
    },
    resume: {
      ...input.current.resume,
      resumable: true,
      requiresUserConfirmation: false,
    },
    updatedAt: input.at,
  });

  delete nextRecord.resume.interruptionDetectedAt;
  delete nextRecord.resume.interruptedDuringCycle;
  delete nextRecord.resume.note;
  delete nextRecord.endedAt;

  return researchSessionRecordSchema.parse(nextRecord);
}

export function advanceResearchSessionCompletedCycle(
  input: AdvanceResearchSessionCompletedCycleInput,
): AdvanceResearchSessionCompletedCycleResult {
  const checkpointed = checkpointResearchSessionCompletedCycle(input);
  const stopCondition = deriveResearchSessionCompletedCycleStopCondition({
    session: checkpointed,
    run: input.run,
    decision: input.decision,
  });

  if (!stopCondition) {
    return {
      transition: "cycle_checkpointed",
      session: checkpointed,
    };
  }

  return {
    transition: "session_halted",
    session: haltResearchSession({
      current: checkpointed,
      stopCondition,
      at: input.at,
    }),
  };
}

export function interruptResearchSession(input: {
  current: ResearchSessionRecord;
  at: string;
  note?: string;
}): ResearchSessionRecord {
  if (input.current.status !== "running") {
    throw new Error(
      `Session ${input.current.sessionId} cannot record an interruption from status ${input.current.status}`,
    );
  }

  const nextRecord = researchSessionRecordSchema.parse({
    ...input.current,
    status: "awaiting_resume",
    stopCondition: {
      type: "none",
    },
    resume: {
      ...input.current.resume,
      resumable: true,
      requiresUserConfirmation: true,
      interruptionDetectedAt: input.at,
      interruptedDuringCycle: input.current.progress.nextCycle,
      ...(input.note ? { note: normalizeRequiredString(input.note, "Resume note") } : {}),
    },
    updatedAt: input.at,
  });

  delete nextRecord.endedAt;

  return researchSessionRecordSchema.parse(nextRecord);
}

export function haltResearchSession(input: {
  current: ResearchSessionRecord;
  stopCondition: Extract<
    ResearchSessionStopCondition,
    { type: "repeated_failures" | "no_meaningful_progress" | "insufficient_evidence" | "operator_stop" }
  >;
  at: string;
}): ResearchSessionRecord {
  if (input.current.status !== "running") {
    throw new Error(`Session ${input.current.sessionId} cannot halt from status ${input.current.status}`);
  }

  const nextRecord = researchSessionRecordSchema.parse({
    ...input.current,
    status: "halted",
    stopCondition: input.stopCondition,
    resume: {
      ...input.current.resume,
      resumable: true,
      requiresUserConfirmation: true,
    },
    updatedAt: input.at,
  });

  delete nextRecord.endedAt;

  return researchSessionRecordSchema.parse(nextRecord);
}

export function completeResearchSession(input: {
  current: ResearchSessionRecord;
  summary: string;
  evidenceBundlePath: string;
  achievedAtCycle?: number;
  promotion?: {
    promotedRunId: string;
    promotedDecisionId: string;
    promotedCommitSha: string;
  };
  at: string;
}): ResearchSessionRecord {
  if (input.current.status !== "running") {
    throw new Error(`Session ${input.current.sessionId} cannot complete from status ${input.current.status}`);
  }

  const achievedAtCycle = input.achievedAtCycle ?? input.current.progress.completedCycles;
  if (achievedAtCycle < 1) {
    throw new Error("Goal completion requires at least one completed cycle");
  }

  const nextRecord = researchSessionRecordSchema.parse({
    ...input.current,
    status: "goal_achieved",
    stopCondition: {
      type: "goal_achieved",
      summary: normalizeRequiredString(input.summary, "Goal summary"),
      achievedAtCycle,
    },
    resume: {
      ...input.current.resume,
      resumable: false,
      requiresUserConfirmation: false,
    },
    evidenceBundlePath: normalizeRequiredString(input.evidenceBundlePath, "Evidence bundle path"),
    updatedAt: input.at,
    endedAt: input.at,
  });

  delete nextRecord.resume.interruptionDetectedAt;
  delete nextRecord.resume.interruptedDuringCycle;
  delete nextRecord.resume.note;

  if (input.promotion) {
    nextRecord.workspace = {
      ...input.current.workspace,
      promoted: true,
      promotedAt: input.at,
      promotedRunId: input.promotion.promotedRunId,
      promotedDecisionId: input.promotion.promotedDecisionId,
      promotedCommitSha: input.promotion.promotedCommitSha,
    };
  }

  return researchSessionRecordSchema.parse(nextRecord);
}

export function failResearchSession(input: {
  current: ResearchSessionRecord;
  message: string;
  stack?: string;
  at: string;
}): ResearchSessionRecord {
  if (!["running", "awaiting_resume", "halted"].includes(input.current.status)) {
    throw new Error(`Session ${input.current.sessionId} cannot fail from status ${input.current.status}`);
  }

  const nextRecord = researchSessionRecordSchema.parse({
    ...input.current,
    status: "failed",
    stopCondition: {
      type: "unrecoverable_error",
      message: normalizeRequiredString(input.message, "Failure message"),
      ...(input.stack ? { stack: normalizeRequiredString(input.stack, "Failure stack") } : {}),
    },
    resume: {
      ...input.current.resume,
      resumable: false,
      requiresUserConfirmation: false,
    },
    updatedAt: input.at,
    endedAt: input.at,
  });

  delete nextRecord.resume.interruptionDetectedAt;
  delete nextRecord.resume.interruptedDuringCycle;
  delete nextRecord.resume.note;

  return researchSessionRecordSchema.parse(nextRecord);
}

export function deriveResearchSessionCompletedCycleStopCondition(input: {
  session: ResearchSessionRecord;
  run: RunRecord;
  decision: DecisionRecord | null;
}): Extract<
  ResearchSessionStopCondition,
  { type: "repeated_failures" | "no_meaningful_progress" | "insufficient_evidence" | "operator_stop" }
> | null {
  if (input.run.status === "needs_human" || input.decision?.outcome === "needs_human") {
    return {
      type: "operator_stop",
      note: `Cycle ${input.run.cycle} requires manual review before continuing.`,
    };
  }

  if (input.session.progress.repeatedFailureStreak >= input.session.stopPolicy.repeatedFailures) {
    return {
      type: "repeated_failures",
      count: input.session.progress.repeatedFailureStreak,
      threshold: input.session.stopPolicy.repeatedFailures,
    };
  }

  if (input.session.progress.noMeaningfulProgressStreak >= input.session.stopPolicy.noMeaningfulProgress) {
    return {
      type: "no_meaningful_progress",
      count: input.session.progress.noMeaningfulProgressStreak,
      threshold: input.session.stopPolicy.noMeaningfulProgress,
    };
  }

  if (input.session.progress.insufficientEvidenceStreak >= input.session.stopPolicy.insufficientEvidence) {
    return {
      type: "insufficient_evidence",
      count: input.session.progress.insufficientEvidenceStreak,
      threshold: input.session.stopPolicy.insufficientEvidence,
    };
  }

  return null;
}

function checkpointResearchSessionCompletedCycle(
  input: AdvanceResearchSessionCompletedCycleInput,
): ResearchSessionRecord {
  if (input.current.status !== "running") {
    throw new Error(
      `Session ${input.current.sessionId} cannot checkpoint a cycle from status ${input.current.status}`,
    );
  }

  if (input.run.cycle !== input.current.progress.nextCycle) {
    throw new Error(
      `Run ${input.run.runId} cycle ${input.run.cycle} does not match next resumable cycle ${input.current.progress.nextCycle}`,
    );
  }

  const frontierIds = [...new Set(input.frontierIds)];
  const nextRecord = researchSessionRecordSchema.parse({
    ...input.current,
    workspace: {
      ...input.current.workspace,
      currentRef: input.run.workspaceRef,
      ...(input.run.workspacePath ? { currentPath: input.run.workspacePath } : {}),
    },
    progress: {
      completedCycles: input.run.cycle,
      nextCycle: input.run.cycle + 1,
      latestRunId: input.run.runId,
      ...(input.decision ? { latestDecisionId: input.decision.decisionId } : {}),
      latestFrontierIds: frontierIds,
      repeatedFailureStreak:
        input.signal.outcome === "failed" ? input.current.progress.repeatedFailureStreak + 1 : 0,
      noMeaningfulProgressStreak:
        input.signal.meaningfulProgress ? 0 : input.current.progress.noMeaningfulProgressStreak + 1,
      insufficientEvidenceStreak:
        input.signal.insufficientEvidence ? input.current.progress.insufficientEvidenceStreak + 1 : 0,
      ...(input.signal.meaningfulProgress ? { lastMeaningfulProgressCycle: input.run.cycle } : {}),
      lastCheckpointAt: input.at,
      lastSignals: {
        cycle: input.run.cycle,
        ...input.signal,
      },
    },
    stopCondition: {
      type: "none",
    },
    resume: {
      resumable: true,
      checkpointType: "completed_cycle_boundary",
      resumeFromCycle: input.run.cycle + 1,
      requiresUserConfirmation: false,
      checkpointRunId: input.run.runId,
      ...(input.decision ? { checkpointDecisionId: input.decision.decisionId } : {}),
    },
    updatedAt: input.at,
  });

  if (!input.signal.meaningfulProgress && input.current.progress.lastMeaningfulProgressCycle !== undefined) {
    nextRecord.progress.lastMeaningfulProgressCycle = input.current.progress.lastMeaningfulProgressCycle;
  }

  delete nextRecord.resume.interruptionDetectedAt;
  delete nextRecord.resume.interruptedDuringCycle;
  delete nextRecord.resume.note;
  delete nextRecord.progress.latestDecisionId;
  delete nextRecord.resume.checkpointDecisionId;
  delete nextRecord.workspace.currentPath;

  if (input.decision) {
    nextRecord.progress.latestDecisionId = input.decision.decisionId;
    nextRecord.resume.checkpointDecisionId = input.decision.decisionId;
  }

  if (input.run.workspacePath) {
    nextRecord.workspace.currentPath = input.run.workspacePath;
  }

  delete nextRecord.endedAt;

  return researchSessionRecordSchema.parse(nextRecord);
}

function normalizeRequiredString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function cloneResearchSessionDraftState(
  draftState: NonNullable<ResearchSessionRecord["draftState"]>,
): NonNullable<ResearchSessionRecord["draftState"]> {
  return {
    currentStep: draftState.currentStep,
    completedSteps: [...draftState.completedSteps],
    returnToReview: draftState.returnToReview,
    reviewConfirmed: draftState.reviewConfirmed,
    ...(draftState.flowState
      ? {
          flowState: {
            ...(draftState.flowState.permissions
              ? {
                  permissions: {
                    ...draftState.flowState.permissions,
                  },
                }
              : {}),
            ...(draftState.flowState.stopRules
              ? {
                  stopRules: {
                    ...draftState.flowState.stopRules,
                  },
                }
              : {}),
            ...(draftState.flowState.outputs
              ? {
                  outputs: {
                    ...draftState.flowState.outputs,
                  },
                }
              : {}),
            ...(draftState.flowState.review
              ? {
                  review: {
                    sections: draftState.flowState.review.sections.map((section) => ({
                      index: section.index,
                      label: section.label,
                      step: section.step,
                      fields: section.fields.map((field) => ({
                        label: field.label,
                        value: field.value,
                      })),
                    })),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(draftState.goalStep
      ? {
          goalStep: {
            ...draftState.goalStep,
          },
        }
      : {}),
    ...(draftState.contextStep
      ? {
          contextStep: {
            ...draftState.contextStep,
          },
        }
      : {}),
    ...(draftState.workspaceStep
      ? {
          workspaceStep: {
            ...draftState.workspaceStep,
          },
        }
      : {}),
    ...(draftState.agentStep
      ? {
          agentStep: {
            ...draftState.agentStep,
          },
        }
      : {}),
  };
}

function createResearchSessionSubmittedSnapshot(
  session: ResearchSessionRecord,
): NonNullable<ResearchSessionRecord["submittedSnapshot"]> {
  return {
    sessionId: session.sessionId,
    goal: session.goal,
    workingDirectory: session.workingDirectory,
    status: session.status,
    agent: {
      ...session.agent,
      ttySession: {
        ...session.agent.ttySession,
      },
    },
    context: {
      trackableGlobs: [...session.context.trackableGlobs],
      webSearch: session.context.webSearch,
      shellCommandAllowlistAdditions: [...session.context.shellCommandAllowlistAdditions],
      shellCommandAllowlistRemovals: [...session.context.shellCommandAllowlistRemovals],
    },
    workspace: {
      ...session.workspace,
    },
    stopPolicy: {
      ...session.stopPolicy,
    },
    progress: {
      ...session.progress,
      latestFrontierIds: [...session.progress.latestFrontierIds],
      ...(session.progress.lastSignals
        ? {
            lastSignals: {
              ...session.progress.lastSignals,
              newArtifacts: [...session.progress.lastSignals.newArtifacts],
              reasons: [...session.progress.lastSignals.reasons],
            },
          }
        : {}),
    },
    stopCondition: {
      ...session.stopCondition,
    },
    resume: {
      ...session.resume,
    },
    ...(session.draftState
      ? {
          draftState: cloneResearchSessionDraftState(session.draftState),
        }
      : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(session.endedAt ? { endedAt: session.endedAt } : {}),
  };
}
