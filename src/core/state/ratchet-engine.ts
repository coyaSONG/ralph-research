import type { RatchetConfig } from "../manifest/schema.js";
import type { FrontierEntry } from "../model/frontier-entry.js";
import type { MetricResult } from "../model/metric.js";
import { buildMetricComparisonReason, directionalDelta } from "./frontier-engine.js";

export interface RatchetDecision {
  outcome: "accepted" | "rejected" | "needs_human";
  frontierChanged: boolean;
  metricId: string;
  reason: string;
  delta?: number;
}

export interface RatchetInput {
  ratchet: RatchetConfig;
  primaryMetric: string;
  candidateMetrics: Record<string, MetricResult>;
  currentFrontier: FrontierEntry[];
  constraintFailureReason?: string;
}

export function evaluateRatchet(input: RatchetInput): RatchetDecision {
  if (input.constraintFailureReason) {
    return {
      outcome: "rejected",
      frontierChanged: false,
      metricId: input.ratchet.metric ?? input.primaryMetric,
      reason: input.constraintFailureReason,
    };
  }

  const metricId = input.ratchet.metric ?? input.primaryMetric;
  const candidateMetric = getCandidateMetric(input.candidateMetrics, metricId);
  const incumbentMetric = input.currentFrontier[0]?.metrics[metricId];

  if (input.ratchet.type === "epsilon_improve") {
    return evaluateEpsilonImprove(metricId, input.ratchet.epsilon, candidateMetric, incumbentMetric);
  }

  return evaluateApprovalGate(metricId, input.ratchet.minConfidence, candidateMetric, incumbentMetric);
}

function evaluateEpsilonImprove(
  metricId: string,
  epsilon: number,
  candidateMetric: MetricResult,
  incumbentMetric?: MetricResult,
): RatchetDecision {
  if (!incumbentMetric) {
    return {
      outcome: "accepted",
      frontierChanged: true,
      metricId,
      reason: `frontier empty; candidate accepted on metric ${metricId}`,
    };
  }

  const delta = directionalDelta(candidateMetric, incumbentMetric);
  if (delta > epsilon) {
    return {
      outcome: "accepted",
      frontierChanged: true,
      metricId,
      delta,
      reason: `${buildMetricComparisonReason(metricId, candidateMetric, incumbentMetric, delta, "improved")}; epsilon=${epsilon}`,
    };
  }

  return {
    outcome: "rejected",
    frontierChanged: false,
    metricId,
    delta,
    reason: `${buildMetricComparisonReason(metricId, candidateMetric, incumbentMetric, delta, "not_improved")}; epsilon=${epsilon}`,
  };
}

function evaluateApprovalGate(
  metricId: string,
  minConfidence: number,
  candidateMetric: MetricResult,
  incumbentMetric?: MetricResult,
): RatchetDecision {
  const confidence = candidateMetric.confidence;

  if (!incumbentMetric) {
    if (confidence === undefined) {
      return {
        outcome: "needs_human",
        frontierChanged: false,
        metricId,
        reason: `frontier empty on metric ${metricId}, but candidate confidence is missing`,
      };
    }

    if (confidence < minConfidence) {
      return {
        outcome: "needs_human",
        frontierChanged: false,
        metricId,
        reason: `frontier empty on metric ${metricId}, but confidence ${confidence.toFixed(2)} is below threshold ${minConfidence.toFixed(2)}`,
      };
    }

    return {
      outcome: "accepted",
      frontierChanged: true,
      metricId,
      reason: `frontier empty; candidate accepted on metric ${metricId} with confidence ${confidence.toFixed(2)}`,
    };
  }

  const delta = directionalDelta(candidateMetric, incumbentMetric);
  if (delta <= 0) {
    return {
      outcome: "rejected",
      frontierChanged: false,
      metricId,
      delta,
      reason: buildMetricComparisonReason(metricId, candidateMetric, incumbentMetric, delta, "not_improved"),
    };
  }

  if (confidence === undefined) {
    return {
      outcome: "needs_human",
      frontierChanged: false,
      metricId,
      delta,
      reason: `${buildMetricComparisonReason(metricId, candidateMetric, incumbentMetric, delta, "improved")}; confidence missing`,
    };
  }

  if (confidence < minConfidence) {
    return {
      outcome: "needs_human",
      frontierChanged: false,
      metricId,
      delta,
      reason: `${buildMetricComparisonReason(metricId, candidateMetric, incumbentMetric, delta, "improved")}; confidence ${confidence.toFixed(2)} below threshold ${minConfidence.toFixed(2)}`,
    };
  }

  return {
    outcome: "accepted",
    frontierChanged: true,
    metricId,
    delta,
    reason: `${buildMetricComparisonReason(metricId, candidateMetric, incumbentMetric, delta, "improved")}; confidence ${confidence.toFixed(2)} passed threshold ${minConfidence.toFixed(2)}`,
  };
}

function getCandidateMetric(metrics: Record<string, MetricResult>, metricId: string): MetricResult {
  const metric = metrics[metricId];
  if (!metric) {
    throw new Error(`Missing candidate metric "${metricId}" for ratchet evaluation`);
  }
  return metric;
}
