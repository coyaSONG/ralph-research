import type { ScopeConfig } from "../manifest/schema.js";
import type { ScopeCheckResult } from "./scope-checker.js";
import { checkScope, collectDiffSummary } from "./scope-checker.js";

export interface EvaluateChangeBudgetInput {
  workspacePath: string;
  scope: ScopeConfig;
  violationOutcome?: "rejected" | "needs_human";
}

export interface ChangeBudgetDecision extends ScopeCheckResult {
  outcome: "none" | "rejected" | "needs_human";
}

export async function evaluateChangeBudget(input: EvaluateChangeBudgetInput): Promise<ChangeBudgetDecision> {
  const summary = await collectDiffSummary(input.workspacePath);
  const scopeCheck = checkScope(summary, input.scope);

  return {
    ...scopeCheck,
    outcome: scopeCheck.withinBudget ? "none" : (input.violationOutcome ?? "rejected"),
  };
}
