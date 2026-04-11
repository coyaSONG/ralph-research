import { z } from "zod";

import {
  DEFAULT_ALLOWED_GLOBS,
  DEFAULT_CODEX_CLI_APPROVAL_POLICY,
  DEFAULT_CODEX_CLI_SANDBOX_MODE,
  DEFAULT_PROJECT_BASELINE_REF,
  DEFAULT_SESSION_INSUFFICIENT_EVIDENCE_LIMIT,
  DEFAULT_SESSION_NO_PROGRESS_LIMIT,
  DEFAULT_SESSION_REPEATED_FAILURE_LIMIT,
  DEFAULT_TTY_SESSION_STARTUP_TIMEOUT_SEC,
  DEFAULT_TTY_SESSION_TURN_TIMEOUT_SEC,
} from "../manifest/defaults.js";
import {
  researchSessionAgentSchema,
  researchSessionContextSchema,
  researchSessionStopPolicySchema,
} from "./research-session.js";

export const researchProjectDefaultsWorkspaceSchema = z.strictObject({
  strategy: z.literal("git_worktree").default("git_worktree"),
  baseRef: z.string().min(1).default(DEFAULT_PROJECT_BASELINE_REF),
});

export const researchProjectDefaultsRecordSchema = z.strictObject({
  recordType: z.literal("research_project_defaults").default("research_project_defaults"),
  version: z.literal(1).default(1),
  workingDirectory: z.string().min(1),
  context: researchSessionContextSchema
    .strict()
    .default({
      trackableGlobs: DEFAULT_ALLOWED_GLOBS,
      webSearch: true,
      shellCommandAllowlistAdditions: [],
      shellCommandAllowlistRemovals: [],
    }),
  workspace: researchProjectDefaultsWorkspaceSchema.default({
    strategy: "git_worktree",
    baseRef: DEFAULT_PROJECT_BASELINE_REF,
  }),
  agent: researchSessionAgentSchema
    .strict()
    .default({
      type: "codex_cli",
      command: "codex",
      approvalPolicy: DEFAULT_CODEX_CLI_APPROVAL_POLICY,
      sandboxMode: DEFAULT_CODEX_CLI_SANDBOX_MODE,
      ttySession: {
        startupTimeoutSec: DEFAULT_TTY_SESSION_STARTUP_TIMEOUT_SEC,
        turnTimeoutSec: DEFAULT_TTY_SESSION_TURN_TIMEOUT_SEC,
      },
    }),
  stopPolicy: researchSessionStopPolicySchema
    .strict()
    .default({
      repeatedFailures: DEFAULT_SESSION_REPEATED_FAILURE_LIMIT,
      noMeaningfulProgress: DEFAULT_SESSION_NO_PROGRESS_LIMIT,
      insufficientEvidence: DEFAULT_SESSION_INSUFFICIENT_EVIDENCE_LIMIT,
    }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ResearchProjectDefaultsRecord = z.infer<typeof researchProjectDefaultsRecordSchema>;
