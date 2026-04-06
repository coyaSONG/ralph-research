import { z } from "zod";

import {
  DEFAULT_ALLOWED_GLOBS,
  DEFAULT_COMMAND_TIMEOUT_SEC,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  DEFAULT_MANIFEST_FILENAME,
  DEFAULT_MAX_FILES_CHANGED,
  DEFAULT_MAX_LINE_DELTA,
  DEFAULT_MAX_PATCH_COUNT,
  DEFAULT_PROPOSER_HISTORY_MAX_RUNS,
  DEFAULT_PROPOSER_EXPLORATION_RATIO,
  DEFAULT_PROJECT_BASELINE_REF,
  DEFAULT_PROJECT_WORKSPACE,
  DEFAULT_SCHEMA_VERSION,
  DEFAULT_STAGNATION_AFTER_REJECTIONS,
  DEFAULT_STORAGE_ROOT,
  manifestDefaults,
} from "./defaults.js";

const recordOfStringsSchema = z.record(z.string(), z.string()).default({});

export const commandSpecSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: recordOfStringsSchema,
  timeoutSec: z.number().int().positive().default(DEFAULT_COMMAND_TIMEOUT_SEC),
});

export const scopeSchema = z.object({
  allowedGlobs: z.array(z.string().min(1)).min(1).default(DEFAULT_ALLOWED_GLOBS),
  maxFilesChanged: z.number().int().positive().default(DEFAULT_MAX_FILES_CHANGED),
  maxLineDelta: z.number().int().positive().default(DEFAULT_MAX_LINE_DELTA),
});

export const projectSchema = z.object({
  name: z.string().min(1),
  artifact: z.enum(["code", "manuscript", "literature_review", "prompt", "generic"]),
  baselineRef: z.string().min(1).default(DEFAULT_PROJECT_BASELINE_REF),
  workspace: z.enum(["git", "copy"]).default(DEFAULT_PROJECT_WORKSPACE),
});

export const proposerHistorySchema = z.object({
  enabled: z.boolean().default(false),
  maxRuns: z.number().int().min(1).default(DEFAULT_PROPOSER_HISTORY_MAX_RUNS),
});

export const commandProposerSchema = z.object({
  type: z.literal("command"),
  ...commandSpecSchema.shape,
  history: proposerHistorySchema.default(manifestDefaults.proposer.history),
});

export const operatorLlmProposerSchema = z.object({
  type: z.literal("operator_llm"),
  model: z.string().min(1),
  prompt: z.string().min(1),
  operators: z.array(z.string().min(1)).min(1),
  explorationRatio: z.number().min(0).max(1).default(DEFAULT_PROPOSER_EXPLORATION_RATIO),
  stagnationAfterRejections: z.number().int().min(1).default(DEFAULT_STAGNATION_AFTER_REJECTIONS),
  maxPatchCount: z.number().int().min(1).default(DEFAULT_MAX_PATCH_COUNT),
  history: proposerHistorySchema.default(manifestDefaults.proposer.history),
});

const leafProposerSchema = z.discriminatedUnion("type", [
  commandProposerSchema,
  operatorLlmProposerSchema,
]);

export const parallelProposerSchema = z.object({
  type: z.literal("parallel"),
  strategies: z.array(leafProposerSchema).min(2),
  pickBest: z.enum(["highest_metric", "judge_pairwise"]),
  history: proposerHistorySchema.default(manifestDefaults.proposer.history),
});

export const proposerSchema = z.discriminatedUnion("type", [
  commandProposerSchema,
  operatorLlmProposerSchema,
  parallelProposerSchema,
]);

export const experimentSchema = z.object({
  run: commandSpecSchema,
  outputs: z
    .array(
      z.object({
        id: z.string().min(1),
        path: z.string().min(1),
      }),
    )
    .default([]),
});

export const judgePackSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(["absolute", "pairwise"]),
  blindPairwise: z.boolean().default(true),
  orderRandomized: z.boolean().default(true),
  repeats: z.number().int().min(1).default(manifestDefaults.judgePack.repeats),
  aggregation: z.enum(["mean", "median", "majority_vote", "sign_test"]).default("majority_vote"),
  judges: z
    .array(
      z.object({
        model: z.string().min(1),
        weight: z.number().positive().default(1),
      }),
    )
    .min(1),
  lowConfidenceThreshold: z.number().min(0).max(1).default(DEFAULT_LOW_CONFIDENCE_THRESHOLD),
  anchors: z
    .object({
      path: z.string().min(1),
      minAgreementWithHuman: z.number().min(0).max(1).default(manifestDefaults.judgePack.anchors.minAgreementWithHuman),
    })
    .optional(),
  audit: z
    .object({
      sampleRate: z.number().min(0).max(1).default(manifestDefaults.judgePack.audit.sampleRate),
      freezeAutoAcceptIfAnchorFails: z.boolean().default(manifestDefaults.judgePack.audit.freezeAutoAcceptIfAnchorFails),
    })
    .default(manifestDefaults.judgePack.audit),
});

export const commandMetricExtractorSchema = z.object({
  type: z.literal("command"),
  ...commandSpecSchema.shape,
  parser: z.enum(["json_path", "regex", "plain_number"]).default("json_path"),
  valuePath: z.string().optional(),
  pattern: z.string().optional(),
});

export const llmJudgeMetricExtractorSchema = z.object({
  type: z.literal("llm_judge"),
  judgePack: z.string().min(1),
  prompt: z.string().min(1),
  mode: z.enum(["absolute", "pairwise"]).default("pairwise"),
  compareAgainst: z.enum(["frontier.best", "none"]).default("frontier.best"),
  inputs: z.record(z.string(), z.string()).default({}),
  outputKey: z.string().min(1).default("score"),
});

export const metricExtractorSchema = z.discriminatedUnion("type", [
  commandMetricExtractorSchema,
  llmJudgeMetricExtractorSchema,
]);

const metricDefinitionBaseSchema = z.object({
  id: z.string().min(1),
  direction: z.enum(["maximize", "minimize"]),
});

export const numericMetricDefinitionSchema = metricDefinitionBaseSchema.extend({
  kind: z.literal("numeric"),
  extractor: commandMetricExtractorSchema,
});

export const llmScoreMetricDefinitionSchema = metricDefinitionBaseSchema.extend({
  kind: z.literal("llm_score"),
  extractor: llmJudgeMetricExtractorSchema,
});

export const metricDefinitionSchema = z.discriminatedUnion("kind", [
  numericMetricDefinitionSchema,
  llmScoreMetricDefinitionSchema,
]);

export const comparisonOperatorSchema = z.enum([">=", ">", "<=", "<", "=="]);

export const constraintSchema = z.object({
  metric: z.string().min(1),
  op: comparisonOperatorSchema,
  value: z.number(),
});

const singleBestFrontierSchema = z.object({
  strategy: z.literal("single_best"),
  primaryMetric: z.string().min(1),
});

export const paretoObjectiveSchema = z.object({
  metric: z.string().min(1),
  epsilon: z.number().nonnegative().default(0),
});

const paretoFrontierSchema = z.object({
  strategy: z.literal("pareto"),
  objectives: z.array(paretoObjectiveSchema).min(2),
  tieBreaker: z.enum(["hypervolume", "none"]).default("hypervolume"),
  referencePoint: z.record(z.string(), z.number()).optional(),
});

export const frontierSchema = z.discriminatedUnion("strategy", [
  singleBestFrontierSchema,
  paretoFrontierSchema,
]);

export const epsilonImproveRatchetSchema = z.object({
  type: z.literal("epsilon_improve"),
  metric: z.string().min(1).optional(),
  epsilon: z.number().default(0),
});

export const approvalGateRatchetSchema = z.object({
  type: z.literal("approval_gate"),
  metric: z.string().min(1).optional(),
  minConfidence: z.number().min(0).max(1).default(DEFAULT_LOW_CONFIDENCE_THRESHOLD),
  graduation: z
    .object({
      consecutiveAccepts: z.number().int().min(1),
      epsilon: z.number().default(0),
    })
    .optional(),
});

export const paretoDominanceRatchetSchema = z.object({
  type: z.literal("pareto_dominance"),
});

export const ratchetSchema = z.discriminatedUnion("type", [
  epsilonImproveRatchetSchema,
  approvalGateRatchetSchema,
  paretoDominanceRatchetSchema,
]);

export const stoppingTargetSchema = z.object({
  metric: z.string().min(1).optional(),
  op: comparisonOperatorSchema,
  value: z.number(),
});

export const stoppingSchema = z.object({
  target: stoppingTargetSchema.optional(),
}).default({});

export const storageSchema = z.object({
  root: z.string().min(1).default(DEFAULT_STORAGE_ROOT),
});

const manifestShapeSchema = z.object({
  schemaVersion: z.literal(DEFAULT_SCHEMA_VERSION),
  project: projectSchema,
  scope: scopeSchema.default(manifestDefaults.scope),
  proposer: proposerSchema,
  experiment: experimentSchema,
  judgePacks: z.array(judgePackSchema).default([]),
  metrics: z.object({
    catalog: z.array(metricDefinitionSchema).min(1),
  }),
  constraints: z.array(constraintSchema).default([]),
  frontier: frontierSchema,
  ratchet: ratchetSchema,
  stopping: stoppingSchema,
  storage: storageSchema.default(manifestDefaults.storage),
});

export const RalphManifestSchema = manifestShapeSchema.superRefine((manifest, ctx) => {
  const metricIds = new Set(manifest.metrics.catalog.map((metric) => metric.id));
  const judgePackIds = new Set(manifest.judgePacks.map((pack) => pack.id));

  if (manifest.frontier.strategy === "single_best" && !metricIds.has(manifest.frontier.primaryMetric)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `frontier.primaryMetric references unknown metric "${manifest.frontier.primaryMetric}"`,
      path: ["frontier", "primaryMetric"],
    });
  }

  if (manifest.frontier.strategy === "pareto") {
    for (const [index, objective] of manifest.frontier.objectives.entries()) {
      if (!metricIds.has(objective.metric)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `frontier objective references unknown metric "${objective.metric}"`,
          path: ["frontier", "objectives", index, "metric"],
        });
      }
    }

    if (manifest.ratchet.type !== "pareto_dominance") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "frontier.strategy=pareto requires ratchet.type=pareto_dominance",
        path: ["ratchet", "type"],
      });
    }
  }

  if (manifest.frontier.strategy === "single_best" && manifest.ratchet.type === "pareto_dominance") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ratchet.type=pareto_dominance requires frontier.strategy=pareto",
      path: ["frontier", "strategy"],
    });
  }

  if ("metric" in manifest.ratchet && manifest.ratchet.metric && !metricIds.has(manifest.ratchet.metric)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `ratchet.metric references unknown metric "${manifest.ratchet.metric}"`,
      path: ["ratchet", "metric"],
    });
  }

  for (const [index, constraint] of manifest.constraints.entries()) {
    if (!metricIds.has(constraint.metric)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `constraint references unknown metric "${constraint.metric}"`,
        path: ["constraints", index, "metric"],
      });
    }
  }

  if (manifest.stopping.target?.metric && !metricIds.has(manifest.stopping.target.metric)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `stopping.target.metric references unknown metric "${manifest.stopping.target.metric}"`,
      path: ["stopping", "target", "metric"],
    });
  }

  for (const [index, metric] of manifest.metrics.catalog.entries()) {
    if (metric.extractor.type === "llm_judge" && !judgePackIds.has(metric.extractor.judgePack)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `metric extractor references unknown judgePack "${metric.extractor.judgePack}"`,
        path: ["metrics", "catalog", index, "extractor", "judgePack"],
      });
    }
  }
});

export type RalphManifest = z.infer<typeof RalphManifestSchema>;
export type ComparisonOperator = z.infer<typeof comparisonOperatorSchema>;
export type ProposerConfig = z.infer<typeof proposerSchema>;
export type MetricExtractor = z.infer<typeof metricExtractorSchema>;
export type JudgePack = z.infer<typeof judgePackSchema>;
export type FrontierConfig = z.infer<typeof frontierSchema>;
export type RatchetConfig = z.infer<typeof ratchetSchema>;
export type StoppingConfig = z.infer<typeof stoppingSchema>;
export type StoppingTargetConfig = z.infer<typeof stoppingTargetSchema>;
export type CommandProposerConfig = z.infer<typeof commandProposerSchema>;
export type ParallelProposerConfig = z.infer<typeof parallelProposerSchema>;
export type CommandMetricExtractorConfig = z.infer<typeof commandMetricExtractorSchema>;
export type CommandSpecConfig = z.infer<typeof commandSpecSchema>;
export type ScopeConfig = z.infer<typeof scopeSchema>;
export type LlmJudgeMetricExtractorConfig = z.infer<typeof llmJudgeMetricExtractorSchema>;
export type ProposerHistoryConfig = z.infer<typeof proposerHistorySchema>;
export type ParetoObjectiveConfig = z.infer<typeof paretoObjectiveSchema>;
export type LeafProposerConfig = z.infer<typeof leafProposerSchema>;

export { DEFAULT_MANIFEST_FILENAME };
