import { z } from "zod";

import { metricResultSchema } from "./metric.js";

export const frontierEntrySchema = z.object({
  frontierId: z.string().min(1),
  runId: z.string().min(1),
  candidateId: z.string().min(1),
  acceptedAt: z.string().datetime(),
  commitSha: z.string().min(1).optional(),
  metrics: z.record(z.string(), metricResultSchema),
  artifacts: z.array(
    z.object({
      id: z.string().min(1),
      path: z.string().min(1),
    }),
  ),
});

export type FrontierEntry = z.infer<typeof frontierEntrySchema>;
