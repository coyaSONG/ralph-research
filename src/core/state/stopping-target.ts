import type { ComparisonOperator, RalphManifest } from "../manifest/schema.js";
import type { FrontierEntry } from "../model/frontier-entry.js";
import type { MetricResult } from "../model/metric.js";

export interface StoppingTargetStatus {
  configured: boolean;
  met: boolean;
  metricId?: string;
  op?: ComparisonOperator;
  targetValue?: number;
  currentValue?: number;
  direction?: MetricResult["direction"];
  reason: string;
}

export function evaluateStoppingTarget(
  manifest: RalphManifest,
  frontier: FrontierEntry[],
): StoppingTargetStatus {
  const target = manifest.stopping.target;
  if (!target) {
    return {
      configured: false,
      met: false,
      reason: "manifest does not define stopping.target",
    };
  }

  const metricId = target.metric ?? getReferenceMetric(manifest);
  const frontierMetrics = frontier
    .map((entry) => entry.metrics[metricId])
    .filter((metric): metric is MetricResult => Boolean(metric));

  if (frontierMetrics.length === 0) {
    return {
      configured: true,
      met: false,
      metricId,
      op: target.op,
      targetValue: target.value,
      reason: `target ${metricId} ${target.op} ${target.value} is not met because the frontier is empty`,
    };
  }

  const bestMetric = frontierMetrics.reduce((best, current) => {
    if (best.direction !== current.direction) {
      throw new Error(`frontier metric direction mismatch for stopping target ${metricId}`);
    }

    if (best.direction === "maximize") {
      return current.value > best.value ? current : best;
    }

    return current.value < best.value ? current : best;
  });

  const met = compare(bestMetric.value, target.op, target.value);
  return {
    configured: true,
    met,
    metricId,
    op: target.op,
    targetValue: target.value,
    currentValue: bestMetric.value,
    direction: bestMetric.direction,
    reason: met
      ? `target met: ${metricId}=${bestMetric.value} ${target.op} ${target.value}`
      : `target pending: ${metricId}=${bestMetric.value} does not satisfy ${target.op} ${target.value}`,
  };
}

function compare(actual: number, op: ComparisonOperator, expected: number): boolean {
  switch (op) {
    case ">=":
      return actual >= expected;
    case ">":
      return actual > expected;
    case "<=":
      return actual <= expected;
    case "<":
      return actual < expected;
    case "==":
      return actual === expected;
  }
}

function getReferenceMetric(manifest: RalphManifest): string {
  if (manifest.frontier.strategy === "single_best") {
    return manifest.frontier.primaryMetric;
  }

  return manifest.frontier.objectives[0]!.metric;
}
