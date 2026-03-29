import type { MetricResult } from "../model/metric.js";

export interface ParallelCandidateResult<TCandidate> {
  strategyIndex: number;
  strategyType: string;
  candidate: TCandidate;
  metrics: Record<string, MetricResult>;
  summary: string;
}

export interface RunParallelProposersInput<TStrategy, TCandidate> {
  strategies: TStrategy[];
  pickBest: "highest_metric" | "judge_pairwise";
  referenceMetric: string;
  execute: (strategy: TStrategy, index: number) => Promise<ParallelCandidateResult<TCandidate>>;
  comparePairwise?: (
    left: ParallelCandidateResult<TCandidate>,
    right: ParallelCandidateResult<TCandidate>,
  ) => Promise<"left" | "right" | "tie">;
}

export interface RunParallelProposersResult<TCandidate> {
  selected: ParallelCandidateResult<TCandidate>;
  candidates: ParallelCandidateResult<TCandidate>[];
  selectionReason: string;
}

export async function runParallelProposers<TStrategy, TCandidate>(
  input: RunParallelProposersInput<TStrategy, TCandidate>,
): Promise<RunParallelProposersResult<TCandidate>> {
  const candidates = await Promise.all(input.strategies.map((strategy, index) => input.execute(strategy, index)));
  if (candidates.length === 0) {
    throw new Error("parallel proposer requires at least one candidate");
  }

  if (input.pickBest === "highest_metric") {
    const selected = selectByHighestMetric(candidates, input.referenceMetric);
    return {
      selected,
      candidates,
      selectionReason: `selected strategy ${selected.strategyIndex + 1} by highest ${input.referenceMetric}`,
    };
  }

  if (!input.comparePairwise) {
    throw new Error("parallel proposer with pickBest=judge_pairwise requires comparePairwise");
  }

  const selected = await selectByPairwiseTournament(candidates, input.comparePairwise, input.referenceMetric);
  return {
    selected,
    candidates,
    selectionReason: `selected strategy ${selected.strategyIndex + 1} by judge_pairwise tournament`,
  };
}

function selectByHighestMetric<TCandidate>(
  candidates: ParallelCandidateResult<TCandidate>[],
  metricId: string,
): ParallelCandidateResult<TCandidate> {
  return [...candidates].sort((left, right) => {
    const leftMetric = getMetric(left, metricId);
    const rightMetric = getMetric(right, metricId);
    const delta =
      leftMetric.direction === "maximize"
        ? rightMetric.value - leftMetric.value
        : leftMetric.value - rightMetric.value;

    if (delta !== 0) {
      return delta;
    }

    return left.strategyIndex - right.strategyIndex;
  })[0]!;
}

async function selectByPairwiseTournament<TCandidate>(
  candidates: ParallelCandidateResult<TCandidate>[],
  comparePairwise: (
    left: ParallelCandidateResult<TCandidate>,
    right: ParallelCandidateResult<TCandidate>,
  ) => Promise<"left" | "right" | "tie">,
  metricId: string,
): Promise<ParallelCandidateResult<TCandidate>> {
  let champion = candidates[0]!;

  for (const challenger of candidates.slice(1)) {
    const verdict = await comparePairwise(champion, challenger);
    if (verdict === "right") {
      champion = challenger;
      continue;
    }

    if (verdict === "tie") {
      champion = selectByHighestMetric([champion, challenger], metricId);
    }
  }

  return champion;
}

function getMetric<TCandidate>(candidate: ParallelCandidateResult<TCandidate>, metricId: string): MetricResult {
  const metric = candidate.metrics[metricId];
  if (!metric) {
    throw new Error(`parallel candidate ${candidate.strategyIndex + 1} is missing metric "${metricId}"`);
  }
  return metric;
}
