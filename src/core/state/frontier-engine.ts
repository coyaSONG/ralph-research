import type { FrontierEntry } from "../model/frontier-entry.js";
import type { ParetoObjectiveConfig } from "../manifest/schema.js";
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

export interface ParetoFrontierUpdate {
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

export function compareParetoFrontier(
  currentFrontier: FrontierEntry[],
  candidateEntry: FrontierEntry,
  objectives: ParetoObjectiveConfig[],
): FrontierComparison {
  if (currentFrontier.length === 0) {
    return {
      outcome: "accepted",
      frontierChanged: true,
      reason: `frontier empty; candidate added to pareto frontier on objectives ${describeObjectives(objectives)}`,
    };
  }

  const dominatingIncumbent = currentFrontier.find((entry) => dominates(entry, candidateEntry, objectives));
  if (dominatingIncumbent) {
    return {
      outcome: "rejected",
      frontierChanged: false,
      incumbent: dominatingIncumbent,
      reason: `candidate is pareto-dominated by ${dominatingIncumbent.frontierId} on objectives ${describeObjectives(objectives)}`,
    };
  }

  const dominatedEntries = currentFrontier.filter((entry) => dominates(candidateEntry, entry, objectives));
  if (dominatedEntries.length > 0) {
    return {
      outcome: "accepted",
      frontierChanged: true,
      reason: `candidate dominates ${dominatedEntries.length} frontier entr${dominatedEntries.length === 1 ? "y" : "ies"} on objectives ${describeObjectives(objectives)}`,
    };
  }

  if (containsEquivalentPoint(currentFrontier, candidateEntry, objectives)) {
    return {
      outcome: "rejected",
      frontierChanged: false,
      reason: `candidate matches an existing pareto point on objectives ${describeObjectives(objectives)}`,
    };
  }

  return {
    outcome: "accepted",
    frontierChanged: true,
    reason: `candidate is non-dominated and expands the pareto frontier on objectives ${describeObjectives(objectives)}`,
  };
}

export function updateParetoFrontier(
  currentFrontier: FrontierEntry[],
  candidateEntry: FrontierEntry,
  objectives: ParetoObjectiveConfig[],
  tieBreaker: "hypervolume" | "none" = "hypervolume",
  referencePoint?: Record<string, number>,
): ParetoFrontierUpdate {
  const comparison = compareParetoFrontier(currentFrontier, candidateEntry, objectives);
  if (!comparison.frontierChanged) {
    return {
      entries: currentFrontier,
      comparison,
    };
  }

  const retained = currentFrontier.filter((entry) => !dominates(candidateEntry, entry, objectives));
  const nextEntries = [...retained, candidateEntry];

  return {
    entries:
      tieBreaker === "hypervolume"
        ? sortByHypervolumeContribution(nextEntries, objectives, referencePoint)
        : nextEntries,
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

function dominates(candidate: FrontierEntry, incumbent: FrontierEntry, objectives: ParetoObjectiveConfig[]): boolean {
  let strictlyBetter = false;

  for (const objective of objectives) {
    const candidateMetric = getMetric(candidate, objective.metric);
    const incumbentMetric = getMetric(incumbent, objective.metric);
    const delta = directionalDelta(candidateMetric, incumbentMetric);

    if (delta < -objective.epsilon) {
      return false;
    }

    if (delta > objective.epsilon) {
      strictlyBetter = true;
    }
  }

  return strictlyBetter;
}

function containsEquivalentPoint(
  frontier: FrontierEntry[],
  candidate: FrontierEntry,
  objectives: ParetoObjectiveConfig[],
): boolean {
  return frontier.some((entry) =>
    objectives.every((objective) => {
      const candidateMetric = getMetric(candidate, objective.metric);
      const incumbentMetric = getMetric(entry, objective.metric);
      const delta = Math.abs(directionalDelta(candidateMetric, incumbentMetric));
      return delta <= objective.epsilon;
    }),
  );
}

function sortByHypervolumeContribution(
  entries: FrontierEntry[],
  objectives: ParetoObjectiveConfig[],
  referencePoint?: Record<string, number>,
): FrontierEntry[] {
  const resolvedReferencePoint =
    referencePoint ??
    Object.fromEntries(
      objectives.map((objective) => {
        const values = entries.map((entry) => getMetric(entry, objective.metric).value);
        const direction = getMetric(entries[0]!, objective.metric).direction;
        const worstValue =
          direction === "maximize" ? Math.min(...values) - 1 : Math.max(...values) + 1;
        return [objective.metric, worstValue];
      }),
    );

  return [...entries].sort((left, right) => {
    const contributionDelta =
      hypervolumeContribution(right, objectives, resolvedReferencePoint) -
      hypervolumeContribution(left, objectives, resolvedReferencePoint);
    if (contributionDelta !== 0) {
      return contributionDelta;
    }

    return left.frontierId.localeCompare(right.frontierId);
  });
}

function hypervolumeContribution(
  entry: FrontierEntry,
  objectives: ParetoObjectiveConfig[],
  referencePoint: Record<string, number>,
): number {
  return objectives.reduce((product, objective) => {
    const metric = getMetric(entry, objective.metric);
    const reference = referencePoint[objective.metric];
    if (reference === undefined) {
      throw new Error(`Missing reference point for pareto objective "${objective.metric}"`);
    }

    const contribution = metric.direction === "maximize" ? metric.value - reference : reference - metric.value;
    return product * Math.max(contribution, 0);
  }, 1);
}

function describeObjectives(objectives: ParetoObjectiveConfig[]): string {
  return objectives.map((objective) => objective.metric).join(", ");
}
