import type { JudgePack, LlmJudgeMetricExtractorConfig } from "../manifest/schema.js";
import type { MetricResult } from "../model/metric.js";
import type { JudgeProvider, JudgeRequest, JudgeResponse, JudgeWinner } from "../../adapters/judge/llm-judge-provider.js";

export interface PairwiseJudgeSample {
  judgeId: string;
  repeat: number;
  winner: JudgeWinner;
  confidence?: number;
  rationale: string;
  raw: string;
}

export interface PairwiseJudgeAggregation {
  mode: "pairwise";
  winner: JudgeWinner;
  confidence: number;
  candidateScore: number;
  voteCounts: Record<JudgeWinner, number>;
  totalVotes: number;
  rationale: string;
  needsHuman: boolean;
}

export interface AbsoluteJudgeAggregation {
  mode: "absolute";
  score: number;
  confidence: number;
  rationale: string;
  needsHuman: boolean;
}

export type JudgeAggregation = PairwiseJudgeAggregation | AbsoluteJudgeAggregation;

export interface EvaluateJudgePackInput {
  pack: JudgePack;
  samples: JudgeResponse[];
}

export interface RunPairwiseJudgePackInput {
  pack: JudgePack;
  extractor: LlmJudgeMetricExtractorConfig;
  prompt: string;
  provider: JudgeProvider;
}

export async function runLlmJudgeMetric(
  input: RunPairwiseJudgePackInput & {
    metricId: string;
    direction: "maximize" | "minimize";
  },
): Promise<MetricResult> {
  const requests = buildRequests(input.pack, input.extractor, input.prompt);
  const samples = await Promise.all(requests.map((request) => input.provider.evaluate(request)));
  const aggregation = evaluateJudgePack({
    pack: input.pack,
    samples,
  });

  return buildJudgeMetricResult(input.metricId, input.direction, aggregation, samples);
}

export function evaluateJudgePack(input: EvaluateJudgePackInput): JudgeAggregation {
  if (input.pack.mode === "pairwise") {
    return aggregatePairwiseSamples(input.pack, input.samples);
  }

  return aggregateAbsoluteSamples(input.pack, input.samples);
}

function aggregatePairwiseSamples(pack: JudgePack, samples: JudgeResponse[]): PairwiseJudgeAggregation {
  const pairwiseSamples = samples.filter((sample): sample is Extract<JudgeResponse, { mode: "pairwise" }> => sample.mode === "pairwise");
  if (pairwiseSamples.length === 0) {
    throw new Error("pairwise judge pack requires at least one pairwise sample");
  }

  const voteCounts: Record<JudgeWinner, number> = {
    candidate: 0,
    incumbent: 0,
    tie: 0,
  };

  for (const sample of pairwiseSamples) {
    voteCounts[sample.winner] += 1;
  }

  const orderedWinners: JudgeWinner[] = ["candidate", "incumbent", "tie"];
  const winner = orderedWinners.reduce((bestWinner, currentWinner) => {
    if (voteCounts[currentWinner] > voteCounts[bestWinner]) {
      return currentWinner;
    }
    return bestWinner;
  }, "tie");

  const totalVotes = pairwiseSamples.length;
  const majorityShare = voteCounts[winner] / totalVotes;
  const averageModelConfidence = meanDefined(pairwiseSamples.map((sample) => sample.confidence));
  const confidence = averageModelConfidence === undefined ? majorityShare : (majorityShare + averageModelConfidence) / 2;
  const candidateScore = (voteCounts.candidate + voteCounts.tie * 0.5) / totalVotes;
  const rationale = `winner=${winner}; votes candidate=${voteCounts.candidate}, incumbent=${voteCounts.incumbent}, tie=${voteCounts.tie}; confidence=${confidence.toFixed(2)}`;

  return {
    mode: "pairwise",
    winner,
    confidence,
    candidateScore,
    voteCounts,
    totalVotes,
    rationale,
    needsHuman: winner === "tie" || confidence < pack.lowConfidenceThreshold,
  };
}

function aggregateAbsoluteSamples(pack: JudgePack, samples: JudgeResponse[]): AbsoluteJudgeAggregation {
  const absoluteSamples = samples.filter((sample): sample is Extract<JudgeResponse, { mode: "absolute" }> => sample.mode === "absolute");
  if (absoluteSamples.length === 0) {
    throw new Error("absolute judge pack requires at least one absolute sample");
  }

  const score = absoluteSamples.reduce((sum, sample) => sum + sample.score, 0) / absoluteSamples.length;
  const reportedConfidence = meanDefined(absoluteSamples.map((sample) => sample.confidence));
  const confidence = reportedConfidence ?? 0.5;

  return {
    mode: "absolute",
    score,
    confidence,
    rationale: `score=${score.toFixed(3)}; confidence=${confidence.toFixed(2)}`,
    needsHuman: confidence < pack.lowConfidenceThreshold,
  };
}

function buildRequests(pack: JudgePack, extractor: LlmJudgeMetricExtractorConfig, prompt: string): JudgeRequest[] {
  const requests: JudgeRequest[] = [];

  for (let repeat = 0; repeat < pack.repeats; repeat += 1) {
    for (const judge of pack.judges) {
      requests.push({
        mode: extractor.mode,
        prompt,
        model: judge.model,
      });
    }
  }

  return requests;
}

function buildJudgeMetricResult(
  metricId: string,
  direction: "maximize" | "minimize",
  aggregation: JudgeAggregation,
  samples: JudgeResponse[],
): MetricResult {
  const value = aggregation.mode === "pairwise" ? aggregation.candidateScore : aggregation.score;

  return {
    metricId,
    direction,
    value,
    confidence: aggregation.confidence,
    details: {
      mode: aggregation.mode,
      needsHuman: aggregation.needsHuman,
      rationale: aggregation.rationale,
      samples,
      ...(aggregation.mode === "pairwise"
        ? {
            winner: aggregation.winner,
            voteCounts: aggregation.voteCounts,
            candidateScore: aggregation.candidateScore,
          }
        : {}),
    },
  };
}

function meanDefined(values: Array<number | undefined>): number | undefined {
  const definedValues = values.filter((value): value is number => value !== undefined);
  if (definedValues.length === 0) {
    return undefined;
  }

  return definedValues.reduce((sum, value) => sum + value, 0) / definedValues.length;
}
