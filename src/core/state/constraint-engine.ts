import type { z } from "zod";

import { constraintSchema } from "../manifest/schema.js";
import type { MetricResult } from "../model/metric.js";

export type ConstraintDefinition = z.infer<typeof constraintSchema>;

export interface ConstraintEvaluation {
  metric: string;
  passed: boolean;
  actual: number;
  expected: number;
  op: ConstraintDefinition["op"];
  reason: string;
}

export interface ConstraintEvaluationSummary {
  passed: boolean;
  results: ConstraintEvaluation[];
  reason: string;
}

export function evaluateConstraints(
  constraints: ConstraintDefinition[],
  metrics: Record<string, MetricResult>,
): ConstraintEvaluationSummary {
  const results = constraints.map((constraint) => {
    const metric = metrics[constraint.metric];
    if (!metric) {
      throw new Error(`Missing metric result for constraint "${constraint.metric}"`);
    }

    const passed = compare(metric.value, constraint.op, constraint.value);
    return {
      metric: constraint.metric,
      passed,
      actual: metric.value,
      expected: constraint.value,
      op: constraint.op,
      reason: passed
        ? `constraint ${constraint.metric} satisfied: ${metric.value} ${constraint.op} ${constraint.value}`
        : `constraint ${constraint.metric} failed: ${metric.value} ${constraint.op} ${constraint.value}`,
    };
  });

  const failed = results.filter((result) => !result.passed);
  return {
    passed: failed.length === 0,
    results,
    reason:
      failed.length === 0
        ? "all constraints satisfied"
        : failed.map((result) => result.reason).join("; "),
  };
}

function compare(actual: number, op: ConstraintDefinition["op"], expected: number): boolean {
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
