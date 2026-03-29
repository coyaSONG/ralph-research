import { z } from "zod";

export const decisionOutcomeSchema = z.enum(["accepted", "rejected", "needs_human"]);

export const decisionRecordSchema = z.object({
  decisionId: z.string().min(1),
  runId: z.string().min(1),
  outcome: decisionOutcomeSchema,
  actorType: z.enum(["system", "human"]),
  actorId: z.string().min(1).optional(),
  policyType: z.string().min(1),
  metricId: z.string().min(1).optional(),
  delta: z.number().optional(),
  reason: z.string().min(1),
  createdAt: z.string().datetime(),
  frontierChanged: z.boolean(),
  beforeFrontierIds: z.array(z.string().min(1)).default([]),
  afterFrontierIds: z.array(z.string().min(1)).default([]),
  commitSha: z.string().min(1).optional(),
  auditRequired: z.boolean().default(false),
});

export type DecisionRecord = z.infer<typeof decisionRecordSchema>;
