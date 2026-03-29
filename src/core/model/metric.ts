import { z } from "zod";

export const metricResultSchema = z.object({
  metricId: z.string().min(1),
  value: z.number(),
  confidence: z.number().min(0).max(1).optional(),
  direction: z.enum(["maximize", "minimize"]),
  judgeTracePath: z.string().min(1).optional(),
  details: z.record(z.string(), z.unknown()).default({}),
});

export type MetricResult = z.infer<typeof metricResultSchema>;
