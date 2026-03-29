import type { FrontierEntry } from "../model/frontier-entry.js";
import type { MetricResult } from "../model/metric.js";

export interface FrontierComparison {
  outcome: "accepted" | "rejected";
  frontierChanged: boolean;
  reason: string;
  incumbent?: FrontierEntry;
  delta?: number;
}

export interface FrontierUpdate {
  entries: FrontierEntry[];
  comparison: FrontierComparison;
}

export function compareSingleBestFrontier(
  currentFrontier: FrontierEntry[],
  candidateEntry: FrontierEntry,
  primaryMetric: string,
): FrontierComparison {
  assertSingleBestShape(currentFrontier);

  if (currentFrontier.length === 0) {
    return {
      outcome: "accepted",
      frontierChanged: true,
      reason: `frontier empty; candidate becomes best entry on metric ${primaryMetric}`,
    };
  }

  const incumbent = currentFrontier[0];
  if (!incumbent) {
    throw new Error("single_best frontier invariant violated: incumbent missing");
  }

  const candidateMetric = getMetric(candidateEntry, primaryMetric);
  const incumbentMetric = getMetric(incumbent, primaryMetric);
  const delta = directionalDelta(candidateMetric, incumbentMetric);

  if (delta > 0) {
    return {
      outcome: "accepted",
      frontierChanged: true,
      incumbent,
      delta,
      reason: buildMetricComparisonReason(primaryMetric, candidateMetric, incumbentMetric, delta, "improved"),
    };
  }

  return {
    outcome: "rejected",
    frontierChanged: false,
    incumbent,
    delta,
    reason: buildMetricComparisonReason(primaryMetric, candidateMetric, incumbentMetric, delta, "not_improved"),
  };
}

export function updateSingleBestFrontier(
  currentFrontier: FrontierEntry[],
  candidateEntry: FrontierEntry,
  primaryMetric: string,
): FrontierUpdate {
  const comparison = compareSingleBestFrontier(currentFrontier, candidateEntry, primaryMetric);
  return {
    entries: comparison.frontierChanged ? [candidateEntry] : currentFrontier,
    comparison,
  };
}

export function directionalDelta(candidate: MetricResult, incumbent: MetricResult): number {
  if (candidate.direction !== incumbent.direction) {
    throw new Error(
      `metric direction mismatch for ${candidate.metricId}: candidate=${candidate.direction}, incumbent=${incumbent.direction}`,
    );
  }

  return candidate.direction === "maximize"
    ? candidate.value - incumbent.value
    : incumbent.value - candidate.value;
}

export function buildMetricComparisonReason(
  metricId: string,
  candidate: MetricResult,
  incumbent: MetricResult,
  delta: number,
  verdict: "improved" | "not_improved",
): string {
  const candidateText = `${metricId} candidate=${candidate.value}`;
  const incumbentText = `${metricId} incumbent=${incumbent.value}`;
  const deltaText = `delta=${delta.toFixed(4)}`;
  return verdict === "improved"
    ? `${candidateText}; ${incumbentText}; ${deltaText}; candidate improved frontier`
    : `${candidateText}; ${incumbentText}; ${deltaText}; candidate did not improve frontier`;
}

function getMetric(entry: FrontierEntry, metricId: string): MetricResult {
  const metric = entry.metrics[metricId];
  if (!metric) {
    throw new Error(`Frontier entry ${entry.frontierId} is missing primary metric "${metricId}"`);
  }
  return metric;
}

function assertSingleBestShape(currentFrontier: FrontierEntry[]): void {
  if (currentFrontier.length > 1) {
    throw new Error(`single_best frontier expected at most one entry, received ${currentFrontier.length}`);
  }
}
