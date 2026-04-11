import { z } from "zod";

export const codexCliSessionLifecyclePhaseSchema = z.enum([
  "starting",
  "running",
  "clean_exit",
  "signaled",
  "non_zero_exit",
  "startup_error",
  "runtime_error",
]);

export const codexCliSessionLifecycleExitSchema = z.object({
  code: z.number().int().nullable(),
  signal: z.string().min(1).nullable(),
});

export const codexCliSessionLifecycleErrorSchema = z.object({
  message: z.string().min(1),
  stack: z.string().min(1).optional(),
});

export const codexCliSessionIdentitySchema = z.object({
  researchSessionId: z.string().min(1),
  codexSessionId: z.string().min(1),
  agent: z.literal("codex_cli").default("codex_cli"),
});

export const codexCliSessionTtySchema = z.object({
  stdinIsTty: z.boolean(),
  stdoutIsTty: z.boolean(),
  columns: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  term: z.string().min(1).optional(),
  startupTimeoutSec: z.number().int().positive(),
  turnTimeoutSec: z.number().int().positive(),
});

export const codexCliSessionAttachmentStateSchema = z.object({
  mode: z.literal("working_directory"),
  status: z.enum(["bound", "released", "unknown"]).default("bound"),
  workingDirectory: z.string().min(1),
  trackedGlobs: z.array(z.string().min(1)).default([]),
  attachedPaths: z.array(z.string().min(1)).default([]),
  extraWritableDirectories: z.array(z.string().min(1)).default([]),
});

export const codexCliSessionReferenceSchema = z.object({
  workspaceRef: z.string().min(1).optional(),
  workspacePath: z.string().min(1).optional(),
  checkpointRunId: z.string().min(1).optional(),
  checkpointDecisionId: z.string().min(1).optional(),
});

export const codexCliSessionLifecycleSchema = z
  .object({
    sessionId: z.string().min(1),
    workingDirectory: z.string().min(1),
    goal: z.string().min(1),
    resumeFromCycle: z.number().int().positive(),
    completedCycles: z.number().int().nonnegative(),
    command: z.string().min(1),
    args: z.array(z.string()),
    approvalPolicy: z.enum(["never", "on-failure", "on-request", "untrusted"]),
    sandboxMode: z.enum(["read-only", "workspace-write", "danger-full-access"]),
    model: z.string().min(1).optional(),
    startedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    phase: codexCliSessionLifecyclePhaseSchema,
    pid: z.number().int().positive().optional(),
    endedAt: z.string().datetime().optional(),
    exit: codexCliSessionLifecycleExitSchema.optional(),
    error: codexCliSessionLifecycleErrorSchema.optional(),
    identity: codexCliSessionIdentitySchema,
    tty: codexCliSessionTtySchema,
    attachmentState: codexCliSessionAttachmentStateSchema,
    references: codexCliSessionReferenceSchema.default({}),
  })
  .superRefine((record, ctx) => {
    if (record.identity.researchSessionId !== record.sessionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "identity.researchSessionId must match sessionId",
        path: ["identity", "researchSessionId"],
      });
    }

    if (record.attachmentState.workingDirectory !== record.workingDirectory) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "attachmentState.workingDirectory must match workingDirectory",
        path: ["attachmentState", "workingDirectory"],
      });
    }

    if (record.attachmentState.attachedPaths.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "working_directory attachment mode cannot persist explicit attachedPaths",
        path: ["attachmentState", "attachedPaths"],
      });
    }

    if ((record.tty.columns === undefined) !== (record.tty.rows === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tty.columns and tty.rows must be recorded together",
        path: ["tty"],
      });
    }

    if (record.references.checkpointDecisionId && !record.references.checkpointRunId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "references.checkpointDecisionId requires references.checkpointRunId",
        path: ["references", "checkpointDecisionId"],
      });
    }

    if (record.completedCycles === 0 && record.references.checkpointRunId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "checkpoint references cannot exist before the first completed cycle",
        path: ["references", "checkpointRunId"],
      });
    }

    if (record.completedCycles > 0 && !record.references.checkpointRunId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "completed cycle checkpoints must record references.checkpointRunId",
        path: ["references", "checkpointRunId"],
      });
    }

    if (record.phase === "starting" || record.phase === "running") {
      if (record.endedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${record.phase} lifecycle records cannot include endedAt`,
          path: ["endedAt"],
        });
      }

      if (record.exit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${record.phase} lifecycle records cannot include exit metadata`,
          path: ["exit"],
        });
      }

      if (record.error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${record.phase} lifecycle records cannot include error metadata`,
          path: ["error"],
        });
      }
    }

    if (record.phase === "clean_exit") {
      if (!record.exit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "clean_exit lifecycle records must include exit metadata",
          path: ["exit"],
        });
      } else if (record.exit.code !== 0 || record.exit.signal !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "clean_exit lifecycle records must record exit code 0 and no signal",
          path: ["exit"],
        });
      }

      if (!record.endedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "clean_exit lifecycle records must include endedAt",
          path: ["endedAt"],
        });
      }

      if (record.error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "clean_exit lifecycle records cannot include error metadata",
          path: ["error"],
        });
      }
    }

    if (record.phase === "signaled") {
      if (!record.exit?.signal) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "signaled lifecycle records must include the terminating signal",
          path: ["exit", "signal"],
        });
      }

      if (!record.endedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "signaled lifecycle records must include endedAt",
          path: ["endedAt"],
        });
      }
    }

    if (record.phase === "non_zero_exit") {
      if (!record.exit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "non_zero_exit lifecycle records must include exit metadata",
          path: ["exit"],
        });
      } else if (record.exit.code === null || record.exit.code === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "non_zero_exit lifecycle records must include a non-zero exit code",
          path: ["exit", "code"],
        });
      }

      if (!record.endedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "non_zero_exit lifecycle records must include endedAt",
          path: ["endedAt"],
        });
      }
    }

    if (record.phase === "startup_error" || record.phase === "runtime_error") {
      if (!record.error?.message) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${record.phase} lifecycle records must include an error message`,
          path: ["error", "message"],
        });
      }

      if (!record.endedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${record.phase} lifecycle records must include endedAt`,
          path: ["endedAt"],
        });
      }
    }
  });

export function parseCodexCliSessionLifecycleRecord(raw: string): CodexCliSessionLifecycleRecord {
  return codexCliSessionLifecycleSchema.parse(JSON.parse(raw));
}

export function serializeCodexCliSessionLifecycleRecord(
  record: CodexCliSessionLifecycleRecord,
): string {
  const parsed = codexCliSessionLifecycleSchema.parse(record);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export type CodexCliSessionLifecycleRecord = z.infer<typeof codexCliSessionLifecycleSchema>;
export type CodexCliSessionLifecyclePhase = z.infer<typeof codexCliSessionLifecyclePhaseSchema>;
export type CodexCliSessionLifecycleExit = z.infer<typeof codexCliSessionLifecycleExitSchema>;
export type CodexCliSessionLifecycleError = z.infer<typeof codexCliSessionLifecycleErrorSchema>;
export type CodexCliSessionTty = z.infer<typeof codexCliSessionTtySchema>;
