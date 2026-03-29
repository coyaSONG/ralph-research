import type { ParetoObjectiveConfig, RatchetConfig } from "../manifest/schema.js";
import type { FrontierEntry } from "../model/frontier-entry.js";
import type { MetricResult } from "../model/metric.js";
import { buildMetricComparisonReason, compareParetoFrontier, directionalDelta } from "./frontier-engine.js";

export interface RatchetDecision {
  outcome: "accepted" | "rejected" | "needs_human";
  frontierChanged: boolean;
  metricId: string;
  policyType: RatchetConfig["type"];
  reason: string;
  delta?: number;
  graduation?: {
    activatedPolicy: "epsilon_improve";
    consecutiveAccepts: number;
    epsilon: number;
    effectiveNextCycle: true;
    reason: string;
  };
}

export interface RatchetInput {
  ratchet: RatchetConfig;
  primaryMetric: string;
  candidateMetrics: Record<string, MetricResult>;
  currentFrontier: FrontierEntry[];
  constraintFailureReason?: string;
  priorConsecutiveAccepts?: number;
  paretoObjectives?: ParetoObjectiveConfig[];
}

export function evaluateRatchet(input: RatchetInput): RatchetDecision {
  const metricId = "metric" in input.ratchet ? input.ratchet.metric ?? input.primaryMetric : input.primaryMetric;

  if (input.constraintFailureReason) {
    return {
      outcome: "rejected",
      frontierChanged: false,
      metricId,
      policyType: input.ratchet.type,
      reason: input.constraintFailureReason,
    };
  }

  const candidateMetric = getCandidateMetric(input.candidateMetrics, metricId);
  const incumbentMetric = input.currentFrontier[0]?.metrics[metricId];
  const priorConsecutiveAccepts = input.priorConsecutiveAccepts ?? 0;

  if (input.ratchet.type === "pareto_dominance") {
    if (!input.paretoObjectives) {
      throw new Error("pareto_dominance ratchet requires paretoObjectives");
    }

    return evaluateParetoDominance(metricId, input.currentFrontier, input.candidateMetrics, input.paretoObjectives);
  }

  if (input.ratchet.type === "epsilon_improve") {
    return evaluateEpsilonImprove(metricId, input.ratchet.epsilon, candidateMetric, incumbentMetric);
  }

  if (input.ratchet.graduation && priorConsecutiveAccepts >= input.ratchet.graduation.consecutiveAccepts) {
    const graduatedDecision = evaluateEpsilonImprove(
      metricId,
      input.ratchet.graduation.epsilon,
      candidateMetric,
      incumbentMetric,
    );

    return {
      ...graduatedDecision,
      reason: `graduated autonomy active after ${priorConsecutiveAccepts} consecutive accepts; ${graduatedDecision.reason}`,
    };
  }

  return evaluateApprovalGate(
    metricId,
    input.ratchet.minConfidence,
    candidateMetric,
    incumbentMetric,
    input.ratchet.graduation,
    priorConsecutiveAccepts,
  );
}

function evaluateParetoDominance(
  metricId: string,
  currentFrontier: FrontierEntry[],
  candidateMetrics: Record<string, MetricResult>,
  objectives: ParetoObjectiveConfig[],
): RatchetDecision {
  const candidateEntry: FrontierEntry = {
    frontierId: "candidate-preview",
    runId: "candidate-preview",
    candidateId: "candidate-preview",
    acceptedAt: new Date(0).toISOString(),
    metrics: candidateMetrics,
    artifacts: [],
  };

  const comparison = compareParetoFrontier(currentFrontier, candidateEntry, objectives);
  return {
    outcome: comparison.outcome,
    frontierChanged: comparison.frontierChanged,
    metricId,
    policyType: "pareto_dominance",
    reason: comparison.reason,
  };
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
      policyType: "epsilon_improve",
      reason: `frontier empty; candidate accepted on metric ${metricId}`,
    };
  }

  const delta = directionalDelta(candidateMetric, incumbentMetric);
  if (delta > epsilon) {
    return {
      outcome: "accepted",
      frontierChanged: true,
      metricId,
      policyType: "epsilon_improve",
      delta,
      reason: `${buildMetricComparisonReason(metricId, candidateMetric, incumbentMetric, delta, "improved")}; epsilon=${epsilon}`,
    };
  }

  return {
    outcome: "rejected",
    frontierChanged: false,
    metricId,
    policyType: "epsilon_improve",
    delta,
    reason: `${buildMetricComparisonReason(metricId, candidateMetric, incumbentMetric, delta, "not_improved")}; epsilon=${epsilon}`,
  };
}

function evaluateApprovalGate(
  metricId: string,
  minConfidence: number,
  candidateMetric: MetricResult,
  incumbentMetric?: MetricResult,
  graduation?: {
    consecutiveAccepts: number;
    epsilon: number;
  },
  priorConsecutiveAccepts = 0,
): RatchetDecision {
  const confidence = candidateMetric.confidence;

  if (!incumbentMetric) {
    if (confidence === undefined) {
      return {
        outcome: "needs_human",
        frontierChanged: false,
        metricId,
        policyType: "approval_gate",
        reason: `frontier empty on metric ${metricId}, but candidate confidence is missing`,
      };
    }

    if (confidence < minConfidence) {
      return {
        outcome: "needs_human",
        frontierChanged: false,
        metricId,
        policyType: "approval_gate",
        reason: `frontier empty on metric ${metricId}, but confidence ${confidence.toFixed(2)} is below threshold ${minConfidence.toFixed(2)}`,
      };
    }

    return {
      outcome: "accepted",
      frontierChanged: true,
      metricId,
      policyType: "approval_gate",
      reason: `frontier empty; candidate accepted on metric ${metricId} with confidence ${confidence.toFixed(2)}`,
      ...(graduation && priorConsecutiveAccepts + 1 >= graduation.consecutiveAccepts
        ? {
            graduation: buildGraduationEvent(metricId, graduation, priorConsecutiveAccepts + 1),
          }
        : {}),
    };
  }

  const delta = directionalDelta(candidateMetric, incumbentMetric);
  if (delta <= 0) {
    return {
      outcome: "rejected",
      frontierChanged: false,
      metricId,
      policyType: "approval_gate",
      delta,
      reason: buildMetricComparisonReason(metricId, candidateMetric, incumbentMetric, delta, "not_improved"),
    };
  }

  if (confidence === undefined) {
    return {
      outcome: "needs_human",
      frontierChanged: false,
      metricId,
      policyType: "approval_gate",
      delta,
      reason: `${buildMetricComparisonReason(metricId, candidateMetric, incumbentMetric, delta, "improved")}; confidence missing`,
    };
  }

  if (confidence < minConfidence) {
    return {
      outcome: "needs_human",
      frontierChanged: false,
      metricId,
      policyType: "approval_gate",
      delta,
      reason: `${buildMetricComparisonReason(metricId, candidateMetric, incumbentMetric, delta, "improved")}; confidence ${confidence.toFixed(2)} below threshold ${minConfidence.toFixed(2)}`,
    };
  }

  return {
    outcome: "accepted",
    frontierChanged: true,
    metricId,
    policyType: "approval_gate",
    delta,
    reason: `${buildMetricComparisonReason(metricId, candidateMetric, incumbentMetric, delta, "improved")}; confidence ${confidence.toFixed(2)} passed threshold ${minConfidence.toFixed(2)}`,
    ...(graduation && priorConsecutiveAccepts + 1 >= graduation.consecutiveAccepts
      ? {
          graduation: buildGraduationEvent(metricId, graduation, priorConsecutiveAccepts + 1),
        }
      : {}),
  };
}

function buildGraduationEvent(
  metricId: string,
  graduation: {
    consecutiveAccepts: number;
    epsilon: number;
  },
  consecutiveAccepts: number,
): NonNullable<RatchetDecision["graduation"]> {
  return {
    activatedPolicy: "epsilon_improve",
    consecutiveAccepts,
    epsilon: graduation.epsilon,
    effectiveNextCycle: true,
    reason: `graduated autonomy unlocked for metric ${metricId} after ${consecutiveAccepts} consecutive accepts`,
  };
}

function getCandidateMetric(metrics: Record<string, MetricResult>, metricId: string): MetricResult {
  const metric = metrics[metricId];
  if (!metric) {
    throw new Error(`Missing candidate metric "${metricId}" for ratchet evaluation`);
  }
  return metric;
}
