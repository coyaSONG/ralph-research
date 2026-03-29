import type { LlmJudgeMetricExtractorConfig, JudgePack } from "../../core/manifest/schema.js";
import type { MetricResult } from "../../core/model/metric.js";
import type { JudgeProvider } from "../judge/llm-judge-provider.js";
import { runLlmJudgeMetric } from "../../core/engine/judge-pack.js";

export interface ExtractLlmJudgeMetricInput {
  metricId: string;
  direction: "maximize" | "minimize";
  prompt: string;
}

export async function extractLlmJudgeMetric(
  config: LlmJudgeMetricExtractorConfig,
  pack: JudgePack,
  input: ExtractLlmJudgeMetricInput,
  provider: JudgeProvider,
): Promise<MetricResult> {
  return runLlmJudgeMetric({
    metricId: input.metricId,
    direction: input.direction,
    extractor: config,
    pack,
    prompt: input.prompt,
    provider,
  });
}
