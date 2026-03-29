import type { DecisionRecord } from "../model/decision-record.js";
import type { MetricResult } from "../model/metric.js";
import type { RunRecord } from "../model/run-record.js";

export interface ProposerHistorySnapshot {
  summary: string;
  recentRuns: RunRecord[];
}

export function countConsecutiveAutoAccepts(
  decisions: DecisionRecord[],
  input: {
    metricId: string;
  },
): number {
  const sorted = [...decisions].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  let streak = 0;

  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const decision = sorted[index]!;
    if (decision.metricId !== input.metricId || decision.policyType !== "approval_gate" || decision.actorType !== "system") {
      break;
    }

    if (decision.outcome !== "accepted") {
      break;
    }

    streak += 1;
  }

  return streak;
}

export function compactRecentHistory(input: {
  runs: RunRecord[];
  decisions: DecisionRecord[];
  maxRuns: number;
  primaryMetric: string;
}): ProposerHistorySnapshot {
  const sortedRuns = [...input.runs].sort((left, right) => left.runId.localeCompare(right.runId));
  const recentRuns = sortedRuns.slice(-input.maxRuns);
  const decisionsByRunId = new Map(input.decisions.map((decision) => [decision.runId, decision]));
  const metricIds = collectMetricIds(recentRuns);
  const lines: string[] = [];

  if (recentRuns.length === 0) {
    lines.push("No prior completed cycles.");
  } else {
    lines.push("Recent cycle history:");
    for (const run of recentRuns) {
      const decision = decisionsByRunId.get(run.runId);
      const primaryMetric = run.metrics[input.primaryMetric];
      lines.push(
        [
          `- ${run.runId}`,
          `status=${run.status}`,
          decision ? `decision=${decision.outcome}` : "decision=missing",
          primaryMetric ? `${input.primaryMetric}=${formatMetric(primaryMetric)}` : `${input.primaryMetric}=n/a`,
          decision?.delta === undefined ? null : `delta=${decision.delta.toFixed(3)}`,
          decision ? `reason=${decision.reason}` : null,
        ]
          .filter(Boolean)
          .join("; "),
      );
    }
  }

  if (metricIds.length > 0) {
    lines.push("");
    lines.push("Metric trends:");
    for (const metricId of metricIds) {
      const trend = recentRuns
        .map((run) => {
          const metric = run.metrics[metricId];
          return metric ? `${run.runId}=${formatMetric(metric)}` : null;
        })
        .filter((value): value is string => value !== null)
        .join(" -> ");

      if (trend) {
        lines.push(`- ${metricId}: ${trend}`);
      }
    }
  }

  return {
    summary: `${lines.join("\n")}\n`,
    recentRuns,
  };
}

function collectMetricIds(runs: RunRecord[]): string[] {
  const metricIds = new Set<string>();
  for (const run of runs) {
    for (const metricId of Object.keys(run.metrics)) {
      metricIds.add(metricId);
    }
  }
  return [...metricIds].sort();
}

function formatMetric(metric: MetricResult): string {
  const suffix = metric.confidence === undefined ? "" : `@${metric.confidence.toFixed(2)}`;
  return `${metric.value.toFixed(3)}${suffix}`;
}
