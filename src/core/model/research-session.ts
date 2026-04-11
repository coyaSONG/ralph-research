import { z } from "zod";

import {
  DEFAULT_ALLOWED_GLOBS,
  DEFAULT_CODEX_CLI_APPROVAL_POLICY,
  DEFAULT_CODEX_CLI_SANDBOX_MODE,
  DEFAULT_SESSION_INSUFFICIENT_EVIDENCE_LIMIT,
  DEFAULT_SESSION_NO_PROGRESS_LIMIT,
  DEFAULT_SESSION_REPEATED_FAILURE_LIMIT,
  DEFAULT_TTY_SESSION_STARTUP_TIMEOUT_SEC,
  DEFAULT_TTY_SESSION_TURN_TIMEOUT_SEC,
} from "../manifest/defaults.js";
import { codexCliSessionLifecyclePhaseSchema } from "./codex-cli-session-lifecycle.js";

export const researchSessionStatusSchema = z.enum([
  "draft",
  "running",
  "awaiting_resume",
  "halted",
  "goal_achieved",
  "failed",
]);

export const RESUMABLE_RESEARCH_SESSION_STATUSES = [
  "running",
  "awaiting_resume",
  "halted",
] as const;

export const researchSessionAgentSchema = z.object({
  type: z.literal("codex_cli"),
  command: z.string().min(1).default("codex"),
  model: z.string().min(1).optional(),
  approvalPolicy: z
    .enum(["never", "on-failure", "on-request", "untrusted"])
    .default(DEFAULT_CODEX_CLI_APPROVAL_POLICY),
  sandboxMode: z
    .enum(["read-only", "workspace-write", "danger-full-access"])
    .default(DEFAULT_CODEX_CLI_SANDBOX_MODE),
  ttySession: z
    .object({
      startupTimeoutSec: z.number().int().positive().default(DEFAULT_TTY_SESSION_STARTUP_TIMEOUT_SEC),
      turnTimeoutSec: z.number().int().positive().default(DEFAULT_TTY_SESSION_TURN_TIMEOUT_SEC),
    })
    .default({
      startupTimeoutSec: DEFAULT_TTY_SESSION_STARTUP_TIMEOUT_SEC,
      turnTimeoutSec: DEFAULT_TTY_SESSION_TURN_TIMEOUT_SEC,
    }),
});

export const researchSessionWorkspaceSchema = z.object({
  strategy: z.literal("git_worktree"),
  baseRef: z.string().min(1).optional(),
  currentRef: z.string().min(1).optional(),
  currentPath: z.string().min(1).optional(),
  promoted: z.boolean().default(false),
  promotedAt: z.string().datetime().optional(),
  promotedRunId: z.string().min(1).optional(),
  promotedDecisionId: z.string().min(1).optional(),
  promotedCommitSha: z.string().min(1).optional(),
});

export const researchSessionContextSchema = z.object({
  trackableGlobs: z.array(z.string().min(1)).min(1).default(DEFAULT_ALLOWED_GLOBS),
  webSearch: z.boolean().default(true),
  shellCommandAllowlistAdditions: z.array(z.string().min(1)).default([]),
  shellCommandAllowlistRemovals: z.array(z.string().min(1)).default([]),
});

export const researchSessionStopPolicySchema = z.object({
  repeatedFailures: z.number().int().min(1).default(DEFAULT_SESSION_REPEATED_FAILURE_LIMIT),
  noMeaningfulProgress: z.number().int().min(1).default(DEFAULT_SESSION_NO_PROGRESS_LIMIT),
  insufficientEvidence: z.number().int().min(1).default(DEFAULT_SESSION_INSUFFICIENT_EVIDENCE_LIMIT),
});

export const researchSessionGoalStepDraftSchema = z.object({
  goal: z.string().optional(),
  agentCommand: z.string().optional(),
  repeatedFailures: z.string().optional(),
  noMeaningfulProgress: z.string().optional(),
  insufficientEvidence: z.string().optional(),
});

export const researchSessionAgentStepDraftSchema = z.object({
  command: z.string().optional(),
  model: z.string().optional(),
  approvalPolicy: z.string().optional(),
  sandboxMode: z.string().optional(),
  startupTimeoutSec: z.string().optional(),
  turnTimeoutSec: z.string().optional(),
});

export const researchSessionWorkspaceStepDraftSchema = z.object({
  workingDirectory: z.string().optional(),
  baseRef: z.string().optional(),
  allowedGlobs: z.string().optional(),
});

export const researchSessionContextStepDraftSchema = z.object({
  trackableGlobs: z.string().optional(),
  webSearch: z.string().optional(),
  shellCommandAllowlistAdditions: z.string().optional(),
  shellCommandAllowlistRemovals: z.string().optional(),
});

export const researchSessionPermissionsFlowStateSchema = z.object({
  workingDirectory: z.string().optional(),
  webSearch: z.string().optional(),
  shellCommandAllowlistAdditions: z.string().optional(),
  shellCommandAllowlistRemovals: z.string().optional(),
  approvalPolicy: z.string().optional(),
  sandboxMode: z.string().optional(),
});

export const researchSessionStopRulesFlowStateSchema = z.object({
  repeatedFailures: z.string().optional(),
  noMeaningfulProgress: z.string().optional(),
  insufficientEvidence: z.string().optional(),
});

export const researchSessionOutputsFlowStateSchema = z.object({
  goal: z.string().optional(),
  trackableGlobs: z.string().optional(),
  baseRef: z.string().optional(),
  agentCommand: z.string().optional(),
  model: z.string().optional(),
  startupTimeoutSec: z.string().optional(),
  turnTimeoutSec: z.string().optional(),
});

export const researchSessionReviewSummaryFieldSchema = z.object({
  label: z.string().min(1),
  value: z.string(),
});

export const researchSessionReviewSectionFlowStateSchema = z.object({
  index: z.string().min(1),
  label: z.string().min(1),
  step: z.enum(["permissions", "stopRules", "outputs"]),
  fields: z.array(researchSessionReviewSummaryFieldSchema).default([]),
});

export const researchSessionReviewFlowStateSchema = z.object({
  sections: z.array(researchSessionReviewSectionFlowStateSchema).default([]),
});

export const researchSessionFlowStateSchema = z.object({
  permissions: researchSessionPermissionsFlowStateSchema.optional(),
  stopRules: researchSessionStopRulesFlowStateSchema.optional(),
  outputs: researchSessionOutputsFlowStateSchema.optional(),
  review: researchSessionReviewFlowStateSchema.optional(),
});

export const researchSessionDraftStepSchema = z.enum([
  "permissions",
  "stopRules",
  "outputs",
  "review",
]);

export const researchSessionDraftStateSchema = z.object({
  currentStep: researchSessionDraftStepSchema.default("permissions"),
  completedSteps: z.array(researchSessionDraftStepSchema).default([]),
  returnToReview: z.boolean().default(false),
  reviewConfirmed: z.boolean().default(false),
  flowState: researchSessionFlowStateSchema.optional(),
  goalStep: researchSessionGoalStepDraftSchema.optional(),
  contextStep: researchSessionContextStepDraftSchema.optional(),
  workspaceStep: researchSessionWorkspaceStepDraftSchema.optional(),
  agentStep: researchSessionAgentStepDraftSchema.optional(),
});

export const researchSessionCycleOutcomeSchema = z.enum([
  "accepted",
  "rejected",
  "needs_human",
  "failed",
]);

export const researchSessionProgressSignalSchema = z.object({
  cycle: z.number().int().positive(),
  outcome: researchSessionCycleOutcomeSchema,
  changedFileCount: z.number().int().nonnegative().default(0),
  diffLineCount: z.number().int().nonnegative().default(0),
  repeatedDiff: z.boolean().default(false),
  verificationDelta: z.number().optional(),
  newArtifacts: z.array(z.string().min(1)).default([]),
  meaningfulProgress: z.boolean(),
  insufficientEvidence: z.boolean().default(false),
  agentTieBreakerUsed: z.boolean().default(false),
  agentSummary: z.string().min(1).optional(),
  reasons: z.array(z.string().min(1)).default([]),
});

export const researchSessionProgressSchema = z.object({
  completedCycles: z.number().int().nonnegative().default(0),
  nextCycle: z.number().int().positive().default(1),
  latestRunId: z.string().min(1).optional(),
  latestDecisionId: z.string().min(1).optional(),
  latestFrontierIds: z.array(z.string().min(1)).default([]),
  repeatedFailureStreak: z.number().int().nonnegative().default(0),
  noMeaningfulProgressStreak: z.number().int().nonnegative().default(0),
  insufficientEvidenceStreak: z.number().int().nonnegative().default(0),
  lastMeaningfulProgressCycle: z.number().int().positive().optional(),
  lastCheckpointAt: z.string().datetime().optional(),
  lastSignals: researchSessionProgressSignalSchema.optional(),
});

export const researchSessionStopConditionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("none"),
  }),
  z.object({
    type: z.literal("goal_achieved"),
    summary: z.string().min(1),
    achievedAtCycle: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("repeated_failures"),
    count: z.number().int().min(1),
    threshold: z.number().int().min(1),
  }),
  z.object({
    type: z.literal("no_meaningful_progress"),
    count: z.number().int().min(1),
    threshold: z.number().int().min(1),
  }),
  z.object({
    type: z.literal("insufficient_evidence"),
    count: z.number().int().min(1),
    threshold: z.number().int().min(1),
  }),
  z.object({
    type: z.literal("operator_stop"),
    note: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("unrecoverable_error"),
    message: z.string().min(1),
    stack: z.string().min(1).optional(),
  }),
]);

export const researchSessionResumeSchema = z.object({
  resumable: z.boolean().default(true),
  checkpointType: z.literal("completed_cycle_boundary"),
  resumeFromCycle: z.number().int().positive(),
  requiresUserConfirmation: z.boolean().default(false),
  checkpointRunId: z.string().min(1).optional(),
  checkpointDecisionId: z.string().min(1).optional(),
  interruptionDetectedAt: z.string().datetime().optional(),
  interruptedDuringCycle: z.number().int().positive().optional(),
  note: z.string().min(1).optional(),
});

export const researchSessionTuiSelectedCandidateDecisionSchema = z.enum([
  "resume",
  "new_session",
]);

export const researchSessionTuiSelectedCandidateConfirmationSchema = z.object({
  required: z.literal(true),
  decision: researchSessionTuiSelectedCandidateDecisionSchema.optional(),
});

export const researchSessionRecoveryClassificationSchema = z.enum([
  "resumable",
  "inspect_only",
  "non_recoverable",
]);

export const researchSessionRuntimeStateSchema = z.enum([
  "active",
  "stale",
  "exited",
  "missing",
]);

export const researchSessionTuiSelectedCandidateCheckpointSchema = z.object({
  completedCycles: z.number().int().nonnegative(),
  latestRunId: z.string().min(1).optional(),
  latestDecisionId: z.string().min(1).optional(),
  lastCheckpointAt: z.string().datetime().optional(),
  stopCondition: z.string().min(1),
});

export const researchSessionTuiSelectedCandidateLatestCycleSchema = z.object({
  outcome: researchSessionCycleOutcomeSchema,
  meaningfulProgress: z.boolean(),
  insufficientEvidence: z.boolean(),
  changedFileCount: z.number().int().nonnegative(),
  diffLineCount: z.number().int().nonnegative(),
  newArtifactCount: z.number().int().nonnegative(),
  agentSummary: z.string().min(1).optional(),
});

export const researchSessionTuiSelectedCandidateRecoverySchema = z.object({
  classification: researchSessionRecoveryClassificationSchema,
  resumeAllowed: z.boolean(),
  reason: z.string().min(1),
  runtimeState: researchSessionRuntimeStateSchema,
  codexPhase: codexCliSessionLifecyclePhaseSchema.optional(),
});

export const researchSessionTuiSelectedCandidateSummarySchema = z.object({
  sessionId: z.string().min(1),
  status: z.enum(RESUMABLE_RESEARCH_SESSION_STATUSES),
  goal: z.string().min(1),
  updatedAt: z.string().datetime(),
  resumeFromCycle: z.number().int().positive(),
  checkpoint: researchSessionTuiSelectedCandidateCheckpointSchema,
  latestCycle: researchSessionTuiSelectedCandidateLatestCycleSchema.optional(),
  recovery: researchSessionTuiSelectedCandidateRecoverySchema.optional(),
  userConfirmation: researchSessionTuiSelectedCandidateConfirmationSchema,
});

const persistedResearchSessionMetadataSourceSchema = z.object({
  sessionId: z.string().min(1),
  goal: z.string().min(1),
  workingDirectory: z.string().min(1),
  status: researchSessionStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  progress: z.object({
    completedCycles: z.number().int().nonnegative(),
    lastCheckpointAt: z.string().datetime().optional(),
  }),
  resume: z.object({
    resumeFromCycle: z.number().int().positive(),
  }),
});

export const researchSessionMetadataSchema = z.object({
  sessionId: z.string().min(1),
  goal: z.string().min(1),
  workingDirectory: z.string().min(1),
  status: researchSessionStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedCycles: z.number().int().nonnegative(),
  lastCheckpointAt: z.string().datetime().optional(),
  resumeFromCycle: z.number().int().positive(),
});

export const researchSessionSubmittedSnapshotSchema = z.object({
  sessionId: z.string().min(1),
  goal: z.string().min(1),
  workingDirectory: z.string().min(1),
  status: researchSessionStatusSchema,
  agent: researchSessionAgentSchema,
  context: researchSessionContextSchema,
  workspace: researchSessionWorkspaceSchema,
  stopPolicy: researchSessionStopPolicySchema,
  progress: researchSessionProgressSchema,
  stopCondition: researchSessionStopConditionSchema,
  resume: researchSessionResumeSchema,
  draftState: researchSessionDraftStateSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
});

export const researchSessionRecordSchema = z
  .object({
    sessionId: z.string().min(1),
    goal: z.string().min(1),
    workingDirectory: z.string().min(1),
    status: researchSessionStatusSchema,
    agent: researchSessionAgentSchema.default({
      type: "codex_cli",
      command: "codex",
      approvalPolicy: DEFAULT_CODEX_CLI_APPROVAL_POLICY,
      sandboxMode: DEFAULT_CODEX_CLI_SANDBOX_MODE,
      ttySession: {
        startupTimeoutSec: DEFAULT_TTY_SESSION_STARTUP_TIMEOUT_SEC,
        turnTimeoutSec: DEFAULT_TTY_SESSION_TURN_TIMEOUT_SEC,
      },
    }),
    context: researchSessionContextSchema.default({
      trackableGlobs: DEFAULT_ALLOWED_GLOBS,
      webSearch: true,
      shellCommandAllowlistAdditions: [],
      shellCommandAllowlistRemovals: [],
    }),
    workspace: researchSessionWorkspaceSchema.default({
      strategy: "git_worktree",
      promoted: false,
    }),
    stopPolicy: researchSessionStopPolicySchema.default({
      repeatedFailures: DEFAULT_SESSION_REPEATED_FAILURE_LIMIT,
      noMeaningfulProgress: DEFAULT_SESSION_NO_PROGRESS_LIMIT,
      insufficientEvidence: DEFAULT_SESSION_INSUFFICIENT_EVIDENCE_LIMIT,
    }),
    progress: researchSessionProgressSchema.default({
      completedCycles: 0,
      nextCycle: 1,
      latestFrontierIds: [],
      repeatedFailureStreak: 0,
      noMeaningfulProgressStreak: 0,
      insufficientEvidenceStreak: 0,
    }),
    stopCondition: researchSessionStopConditionSchema.default({
      type: "none",
    }),
    resume: researchSessionResumeSchema.default({
      resumable: true,
      checkpointType: "completed_cycle_boundary",
      resumeFromCycle: 1,
      requiresUserConfirmation: false,
    }),
    submittedSnapshot: researchSessionSubmittedSnapshotSchema.optional(),
    draftState: researchSessionDraftStateSchema.optional(),
    evidenceBundlePath: z.string().min(1).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    endedAt: z.string().datetime().optional(),
  })
  .superRefine((record, ctx) => {
    if (record.progress.nextCycle !== record.progress.completedCycles + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "progress.nextCycle must advance from the last completed cycle boundary",
        path: ["progress", "nextCycle"],
      });
    }

    if (record.resume.resumeFromCycle !== record.progress.nextCycle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "resume.resumeFromCycle must match progress.nextCycle",
        path: ["resume", "resumeFromCycle"],
      });
    }

    if (
      record.submittedSnapshot &&
      record.submittedSnapshot.sessionId !== record.sessionId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "submittedSnapshot.sessionId must match the persisted sessionId",
        path: ["submittedSnapshot", "sessionId"],
      });
    }

    if (record.resume.interruptedDuringCycle !== undefined && record.resume.interruptedDuringCycle !== record.resume.resumeFromCycle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "interruptedDuringCycle must point at the discarded in-flight cycle",
        path: ["resume", "interruptedDuringCycle"],
      });
    }

    if (record.progress.latestDecisionId && !record.progress.latestRunId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "latestDecisionId requires latestRunId",
        path: ["progress", "latestDecisionId"],
      });
    }

    if (record.resume.checkpointDecisionId && !record.resume.checkpointRunId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "checkpointDecisionId requires checkpointRunId",
        path: ["resume", "checkpointDecisionId"],
      });
    }

    if (record.resume.checkpointRunId && record.resume.checkpointRunId !== record.progress.latestRunId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "checkpointRunId must match progress.latestRunId at the last completed cycle boundary",
        path: ["resume", "checkpointRunId"],
      });
    }

    if (record.resume.checkpointDecisionId && record.resume.checkpointDecisionId !== record.progress.latestDecisionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "checkpointDecisionId must match progress.latestDecisionId at the last completed cycle boundary",
        path: ["resume", "checkpointDecisionId"],
      });
    }

    if (record.progress.lastSignals && record.progress.lastSignals.cycle !== record.progress.completedCycles) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "lastSignals must describe the most recently completed cycle",
        path: ["progress", "lastSignals", "cycle"],
      });
    }

    if (record.progress.completedCycles > 0) {
      if (!record.progress.latestRunId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "completed sessions must capture the latest run id at the last completed cycle boundary",
          path: ["progress", "latestRunId"],
        });
      }

      if (!record.progress.lastCheckpointAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "completed sessions must capture lastCheckpointAt at the last completed cycle boundary",
          path: ["progress", "lastCheckpointAt"],
        });
      }

      if (!record.progress.lastSignals) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "completed sessions must capture progress.lastSignals for the most recent completed cycle",
          path: ["progress", "lastSignals"],
        });
      }

      if (!record.resume.checkpointRunId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "completed sessions must capture resume.checkpointRunId for safe restart semantics",
          path: ["resume", "checkpointRunId"],
        });
      }
    }

    if (record.status === "running") {
      if (record.stopCondition.type !== "none") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "running sessions cannot declare a stop condition",
          path: ["stopCondition"],
        });
      }

      if (record.resume.requiresUserConfirmation) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "running sessions cannot require resume confirmation",
          path: ["resume", "requiresUserConfirmation"],
        });
      }
    }

    if (record.status === "draft") {
      if (record.stopCondition.type !== "none") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "draft sessions cannot declare a stop condition",
          path: ["stopCondition"],
        });
      }

      if (record.endedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "draft sessions cannot include endedAt",
          path: ["endedAt"],
        });
      }
    }

    if (record.status === "awaiting_resume") {
      if (!record.resume.requiresUserConfirmation) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "awaiting_resume sessions must require user confirmation",
          path: ["resume", "requiresUserConfirmation"],
        });
      }

      if (!record.resume.interruptionDetectedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "awaiting_resume sessions must record interruptionDetectedAt",
          path: ["resume", "interruptionDetectedAt"],
        });
      }
    }

    if (record.status === "halted") {
      if (!record.resume.requiresUserConfirmation) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "halted sessions must require user confirmation before resuming",
          path: ["resume", "requiresUserConfirmation"],
        });
      }

      if (!["repeated_failures", "no_meaningful_progress", "insufficient_evidence", "operator_stop"].includes(record.stopCondition.type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "halted sessions must record a halt stop condition",
          path: ["stopCondition"],
        });
      }
    }

    if (record.status === "goal_achieved") {
      if (record.stopCondition.type !== "goal_achieved") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "goal_achieved sessions must record a goal_achieved stop condition",
          path: ["stopCondition"],
        });
      }

      if (!record.evidenceBundlePath) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "goal_achieved sessions must include evidenceBundlePath",
          path: ["evidenceBundlePath"],
        });
      }

      if (!record.endedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "goal_achieved sessions must include endedAt",
          path: ["endedAt"],
        });
      }
    }

    if (record.status === "failed") {
      if (record.stopCondition.type !== "unrecoverable_error") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "failed sessions must record an unrecoverable_error stop condition",
          path: ["stopCondition"],
        });
      }

      if (!record.endedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "failed sessions must include endedAt",
          path: ["endedAt"],
        });
      }
    }

    if (record.workspace.promoted && record.status !== "goal_achieved") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "only goal_achieved sessions may promote work back into the source workspace",
        path: ["workspace", "promoted"],
      });
    }

    if (record.workspace.promoted) {
      if (!record.workspace.promotedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "promoted workspaces must include promotedAt",
          path: ["workspace", "promotedAt"],
        });
      }

      if (!record.workspace.promotedRunId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "promoted workspaces must include promotedRunId",
          path: ["workspace", "promotedRunId"],
        });
      }

      if (!record.workspace.promotedDecisionId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "promoted workspaces must include promotedDecisionId",
          path: ["workspace", "promotedDecisionId"],
        });
      }

      if (!record.workspace.promotedCommitSha) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "promoted workspaces must include promotedCommitSha",
          path: ["workspace", "promotedCommitSha"],
        });
      }
    }

    if (
      !record.workspace.promoted
      && (
        record.workspace.promotedAt
        || record.workspace.promotedRunId
        || record.workspace.promotedDecisionId
        || record.workspace.promotedCommitSha
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "unpromoted workspaces cannot carry promotion metadata",
        path: ["workspace"],
      });
    }
  });

export type ResearchSessionRecord = z.infer<typeof researchSessionRecordSchema>;
export type ResearchSessionAgent = z.infer<typeof researchSessionAgentSchema>;
export type ResearchSessionStatus = z.infer<typeof researchSessionStatusSchema>;
export type ResumableResearchSessionStatus = (typeof RESUMABLE_RESEARCH_SESSION_STATUSES)[number];
export type ResearchSessionWorkspace = z.infer<typeof researchSessionWorkspaceSchema>;
export type ResearchSessionStopPolicy = z.infer<typeof researchSessionStopPolicySchema>;
export type ResearchSessionCycleOutcome = z.infer<typeof researchSessionCycleOutcomeSchema>;
export type ResearchSessionProgress = z.infer<typeof researchSessionProgressSchema>;
export type ResearchSessionProgressSignal = z.infer<typeof researchSessionProgressSignalSchema>;
export type ResearchSessionStopCondition = z.infer<typeof researchSessionStopConditionSchema>;
export type ResearchSessionResume = z.infer<typeof researchSessionResumeSchema>;
export type ResearchSessionTuiSelectedCandidateDecision = z.infer<
  typeof researchSessionTuiSelectedCandidateDecisionSchema
>;
export type ResearchSessionTuiSelectedCandidateConfirmation = z.infer<
  typeof researchSessionTuiSelectedCandidateConfirmationSchema
>;
export type ResearchSessionTuiSelectedCandidateSummary = z.infer<
  typeof researchSessionTuiSelectedCandidateSummarySchema
>;
export type ResearchSessionMetadata = z.infer<typeof researchSessionMetadataSchema>;

export interface BuildResearchSessionTuiSelectedCandidateSummaryOptions {
  recovery?: ResearchSessionTuiSelectedCandidateSummary["recovery"];
}

export function isResumableResearchSessionStatus(
  status: ResearchSessionStatus,
): status is ResumableResearchSessionStatus {
  return RESUMABLE_RESEARCH_SESSION_STATUSES.includes(
    status as ResumableResearchSessionStatus,
  );
}

export function buildResearchSessionTuiSelectedCandidateSummary(
  session: ResearchSessionRecord,
  options: BuildResearchSessionTuiSelectedCandidateSummaryOptions = {},
): ResearchSessionTuiSelectedCandidateSummary {
  const latestCycle = session.progress.lastSignals
    ? {
        outcome: session.progress.lastSignals.outcome,
        meaningfulProgress: session.progress.lastSignals.meaningfulProgress,
        insufficientEvidence: session.progress.lastSignals.insufficientEvidence ?? false,
        changedFileCount: session.progress.lastSignals.changedFileCount,
        diffLineCount: session.progress.lastSignals.diffLineCount,
        newArtifactCount: session.progress.lastSignals.newArtifacts?.length ?? 0,
        ...(session.progress.lastSignals.agentSummary
          ? { agentSummary: session.progress.lastSignals.agentSummary }
          : {}),
      }
    : undefined;

  return researchSessionTuiSelectedCandidateSummarySchema.parse({
    sessionId: session.sessionId,
    status: session.status,
    goal: session.goal,
    updatedAt: session.updatedAt,
    resumeFromCycle: session.resume.resumeFromCycle,
    checkpoint: {
      completedCycles: session.progress.completedCycles,
      ...(session.progress.latestRunId ? { latestRunId: session.progress.latestRunId } : {}),
      ...(session.progress.latestDecisionId
        ? { latestDecisionId: session.progress.latestDecisionId }
        : {}),
      ...(session.progress.lastCheckpointAt
        ? { lastCheckpointAt: session.progress.lastCheckpointAt }
        : {}),
      stopCondition: session.stopCondition.type,
    },
    ...(latestCycle ? { latestCycle } : {}),
    ...(options.recovery ? { recovery: options.recovery } : {}),
    userConfirmation: {
      required: true,
    },
  });
}

export function buildResearchSessionMetadata(
  session: Pick<
    ResearchSessionRecord,
    "sessionId" | "goal" | "workingDirectory" | "status" | "createdAt" | "updatedAt" | "progress" | "resume"
  >,
): ResearchSessionMetadata {
  return researchSessionMetadataSchema.parse({
    sessionId: session.sessionId,
    goal: session.goal,
    workingDirectory: session.workingDirectory,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    completedCycles: session.progress.completedCycles,
    ...(session.progress.lastCheckpointAt
      ? { lastCheckpointAt: session.progress.lastCheckpointAt }
      : {}),
    resumeFromCycle: session.resume.resumeFromCycle,
  });
}

export function parsePersistedResearchSessionMetadata(value: unknown): ResearchSessionMetadata {
  const parsed = persistedResearchSessionMetadataSourceSchema.parse(value);

  return researchSessionMetadataSchema.parse({
    sessionId: parsed.sessionId,
    goal: parsed.goal,
    workingDirectory: parsed.workingDirectory,
    status: parsed.status,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    completedCycles: parsed.progress.completedCycles,
    ...(parsed.progress.lastCheckpointAt ? { lastCheckpointAt: parsed.progress.lastCheckpointAt } : {}),
    resumeFromCycle: parsed.resume.resumeFromCycle,
  });
}
