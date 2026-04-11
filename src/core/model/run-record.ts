import { z } from "zod";

import { metricResultSchema } from "./metric.js";

const codexCliProposerInvocationSchema = z.object({
  sessionId: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().min(1),
  sessionMetadata: z
    .object({
      launchMode: z.enum(["new", "resume"]),
      researchSessionId: z.string().min(1),
      codexSessionId: z.string().min(1).optional(),
    })
    .optional(),
});

const codexCliProposerOutcomeSchema = z.object({
  kind: z.literal("terminal_exit"),
  code: z.number().int().nullable(),
  signal: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  summary: z.string().min(1),
});

const proposalAdapterMetadataSchema = z.discriminatedUnion("adapter", [
  z.object({
    adapter: z.literal("codex_cli"),
    invocation: codexCliProposerInvocationSchema,
    outcome: codexCliProposerOutcomeSchema,
  }),
]);

export const runPhaseSchema = z.enum([
  "started",
  "proposed",
  "executed",
  "evaluated",
  "decision_written",
  "committed",
  "frontier_updated",
  "completed",
  "failed",
]);

export const pendingActionSchema = z.enum([
  "none",
  "prepare_proposal",
  "execute_experiment",
  "evaluate_metrics",
  "write_decision",
  "commit_candidate",
  "update_frontier",
  "cleanup_workspace",
]);

export const runStatusSchema = z.enum([
  "running",
  "evaluated",
  "accepted",
  "rejected",
  "needs_human",
  "failed",
]);

export const runRecordSchema = z
  .object({
    runId: z.string().min(1),
    cycle: z.number().int().nonnegative(),
    candidateId: z.string().min(1),
    status: runStatusSchema,
    phase: runPhaseSchema,
    pendingAction: pendingActionSchema.default("none"),
    startedAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
    currentStepStartedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().optional(),
    manifestHash: z.string().min(1),
    workspaceRef: z.string().min(1),
    workspacePath: z.string().min(1).optional(),
    proposal: z.object({
      proposerType: z.string().min(1),
      summary: z.string().min(1),
      operators: z.array(z.string().min(1)).default([]),
      adapterMetadata: proposalAdapterMetadataSchema.optional(),
      patchPath: z.string().min(1).optional(),
      diffLines: z.number().int().nonnegative().optional(),
      filesChanged: z.number().int().nonnegative().optional(),
      changedPaths: z.array(z.string().min(1)).optional(),
      withinBudget: z.boolean().optional(),
    }),
    artifacts: z.array(
      z.object({
        id: z.string().min(1),
        path: z.string().min(1),
      }),
    ),
    metrics: z.record(z.string(), metricResultSchema).default({}),
    constraints: z
      .array(
        z.object({
          metric: z.string().min(1),
          passed: z.boolean(),
          actual: z.number(),
          expected: z.number(),
          op: z.string().min(1),
        }),
      )
      .default([]),
    decisionId: z.string().min(1).optional(),
    logs: z
      .object({
        proposeStdoutPath: z.string().min(1).optional(),
        runStdoutPath: z.string().min(1).optional(),
      })
      .default({}),
    error: z
      .object({
        message: z.string().min(1),
        stack: z.string().min(1).optional(),
      })
      .optional(),
  })
  .superRefine((record, ctx) => {
    if (record.phase === "completed" && !record.endedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "completed runs must include endedAt",
        path: ["endedAt"],
      });
    }

    if (record.phase === "failed" && !record.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "failed runs must include error information",
        path: ["error"],
      });
    }

    if (record.phase === "decision_written" && !record.decisionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "decision_written runs must include a decisionId",
        path: ["decisionId"],
      });
    }
  });

export type RunRecord = z.infer<typeof runRecordSchema>;
export type RunPhase = z.infer<typeof runPhaseSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type PendingAction = z.infer<typeof pendingActionSchema>;
export type ProposalAdapterMetadata = z.infer<typeof proposalAdapterMetadataSchema>;
