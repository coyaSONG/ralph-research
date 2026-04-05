import type { DecisionRecord } from "../model/decision-record.js";
import type { FrontierEntry } from "../model/frontier-entry.js";
import type { PendingAction, RunRecord } from "../model/run-record.js";

export type RecoveryClassification =
  | "idle"
  | "resumable"
  | "manual_review_blocked"
  | "repair_required";

export interface RecoveryStatus {
  classification: RecoveryClassification;
  nextAction: PendingAction;
  reason: string;
  resumeAllowed: boolean;
}

export interface RecoveryClassificationInput {
  latestRun: RunRecord | null;
  decision?: DecisionRecord | null;
  frontier?: FrontierEntry[];
}

export function derivePendingAction(
  run: Pick<RunRecord, "phase" | "status" | "pendingAction">,
): PendingAction {
  switch (run.phase) {
    case "started":
      return "prepare_proposal";
    case "proposed":
      return "execute_experiment";
    case "executed":
      return "evaluate_metrics";
    case "evaluated":
      return "write_decision";
    case "decision_written":
      if (run.status === "accepted") {
        return "commit_candidate";
      }
      if (run.status === "needs_human") {
        return "none";
      }
      return "cleanup_workspace";
    case "committed":
      return "update_frontier";
    case "frontier_updated":
      return "cleanup_workspace";
    case "completed":
    case "failed":
      return "none";
  }
}

export function classifyRecovery(
  input: RecoveryClassificationInput,
): RecoveryStatus {
  const run = input.latestRun;
  if (!run) {
    return {
      classification: "idle",
      nextAction: "none",
      reason: "no latest run exists",
      resumeAllowed: false,
    };
  }

  if (run.status === "needs_human") {
    return {
      classification: "manual_review_blocked",
      nextAction: "none",
      reason: "latest run is waiting for manual review",
      resumeAllowed: false,
    };
  }

  if (run.proposal.proposerType === "parallel") {
    return {
      classification: "repair_required",
      nextAction: "none",
      reason: "parallel proposer runs cannot be resumed truthfully yet",
      resumeAllowed: false,
    };
  }

  if (run.phase === "completed") {
    return {
      classification: "idle",
      nextAction: "none",
      reason: "latest run already completed",
      resumeAllowed: false,
    };
  }

  if (run.phase === "failed") {
    return {
      classification: "repair_required",
      nextAction: "none",
      reason: "latest run failed and requires repair before it can be trusted",
      resumeAllowed: false,
    };
  }

  const nextAction = run.pendingAction !== "none"
    ? run.pendingAction
    : derivePendingAction(run);
  const evidenceFailure = findEvidenceFailure(input, nextAction);
  if (evidenceFailure) {
    return {
      classification: "repair_required",
      nextAction: "none",
      reason: evidenceFailure,
      resumeAllowed: false,
    };
  }

  return {
    classification: "resumable",
    nextAction,
    reason: `resume from ${run.phase} via ${nextAction}`,
    resumeAllowed: true,
  };
}

function findEvidenceFailure(
  input: RecoveryClassificationInput,
  nextAction: PendingAction,
): string | null {
  const run = input.latestRun;
  if (!run) {
    return "missing latest run";
  }

  switch (run.phase) {
    case "started":
      return null;
    case "proposed":
      if (!run.workspacePath) {
        return "proposal checkpoint is missing a durable workspace path";
      }
      if (run.proposal.summary === "proposal pending") {
        return "proposal checkpoint does not contain a durable proposal result";
      }
      return null;
    case "executed":
      if (!run.workspacePath) {
        return "experiment checkpoint is missing a durable workspace path";
      }
      if (!run.logs.runStdoutPath) {
        return "experiment checkpoint is missing execution logs";
      }
      return null;
    case "evaluated":
      if (Object.keys(run.metrics).length === 0) {
        return "evaluation checkpoint is missing persisted metrics";
      }
      return null;
    case "decision_written":
      if (!run.decisionId) {
        return "decision checkpoint is missing the decision identifier";
      }
      if (run.status === "accepted" && !run.proposal.patchPath) {
        return "accepted decision checkpoint is missing a durable promotion patch";
      }
      if (run.status === "accepted" && nextAction !== "commit_candidate") {
        return "accepted decision checkpoint has an invalid next action";
      }
      return null;
    case "committed":
      if (!run.decisionId) {
        return "commit checkpoint is missing the decision identifier";
      }
      if (!input.decision?.commitSha) {
        return "commit checkpoint is missing a durable commit sha";
      }
      if (frontierContainsRun(input.frontier, run.runId)) {
        return "commit checkpoint already appears in frontier state";
      }
      return null;
    case "frontier_updated":
      if (!frontierContainsRun(input.frontier, run.runId)) {
        return "frontier-updated checkpoint is missing persisted frontier membership";
      }
      return null;
    case "completed":
    case "failed":
      return null;
  }
}

function frontierContainsRun(
  frontier: FrontierEntry[] | undefined,
  runId: string,
): boolean {
  return frontier?.some((entry) => entry.runId === runId) ?? false;
}
