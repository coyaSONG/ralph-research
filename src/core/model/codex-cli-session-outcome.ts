import { z } from "zod";

export const CODEX_CLI_SESSION_OUTCOME_BEGIN_MARKER = "RRX_SESSION_OUTCOME_BEGIN";
export const CODEX_CLI_SESSION_OUTCOME_END_MARKER = "RRX_SESSION_OUTCOME_END";

const workspaceRelativePathSchema = z.string().min(1).superRefine((value, ctx) => {
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "paths must stay relative to the working directory",
    });
    return;
  }

  const segments = value.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0 || segments.includes("..")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "paths must stay within the working directory",
    });
  }
});

export const codexCliProposalResultReasonCodeSchema = z.enum([
  "proposal_ready",
]);

export const codexCliExplicitFailureReasonCodeSchema = z.enum([
  "agent_declared_failure",
  "insufficient_evidence",
  "no_meaningful_progress",
  "repeated_failures",
  "verification_failed",
]);

export const codexCliTerminalRuntimeErrorReasonCodeSchema = z.enum([
  "duplicate_terminal_outcomes",
  "invalid_terminal_outcome",
  "missing_terminal_outcome",
  "partial_terminal_outcome",
  "process_exit_non_zero",
  "process_exit_signaled",
  "transcript_not_finalized",
]);

export const codexCliProposalResultSchema = z.object({
  type: z.literal("proposal_result"),
  reasonCode: codexCliProposalResultReasonCodeSchema,
  summary: z.string().min(1),
  changedPaths: z.array(workspaceRelativePathSchema).min(1),
  verificationArtifactPaths: z.array(workspaceRelativePathSchema).min(1),
});

export const codexCliExplicitFailureSchema = z.object({
  type: z.literal("explicit_failure"),
  reasonCode: codexCliExplicitFailureReasonCodeSchema,
  summary: z.string().min(1),
  evidencePaths: z.array(workspaceRelativePathSchema).default([]),
});

export const codexCliAgentTerminalOutcomeSchema = z.discriminatedUnion("type", [
  codexCliProposalResultSchema,
  codexCliExplicitFailureSchema,
]);

export const codexCliTerminalRuntimeErrorSchema = z.object({
  type: z.literal("terminal_runtime_error"),
  reasonCode: codexCliTerminalRuntimeErrorReasonCodeSchema,
  summary: z.string().min(1),
  exit: z.object({
    code: z.number().int().nullable(),
    signal: z.string().nullable(),
  }),
});

export const codexCliSessionOutcomeSchema = z.discriminatedUnion("type", [
  codexCliProposalResultSchema,
  codexCliExplicitFailureSchema,
  codexCliTerminalRuntimeErrorSchema,
]);

export type CodexCliProposalResult = z.infer<typeof codexCliProposalResultSchema>;
export type CodexCliExplicitFailure = z.infer<typeof codexCliExplicitFailureSchema>;
export type CodexCliAgentTerminalOutcome = z.infer<typeof codexCliAgentTerminalOutcomeSchema>;
export type CodexCliTerminalRuntimeError = z.infer<typeof codexCliTerminalRuntimeErrorSchema>;
export type CodexCliSessionOutcome = z.infer<typeof codexCliSessionOutcomeSchema>;
