import {
  pendingActionSchema,
  runRecordSchema,
  type RunPhase,
  type RunRecord,
  type RunStatus,
} from "../model/run-record.js";
import { classifyRecovery, derivePendingAction } from "./recovery-classifier.js";

export type PendingAction = RunRecord["pendingAction"];

export interface AdvanceRunPhaseOptions {
  at?: string;
  status?: RunStatus;
  decisionId?: string;
  error?: RunRecord["error"];
  pendingAction?: PendingAction;
}

export interface RecoveryPlan {
  resumable: boolean;
  nextAction: PendingAction;
  reason: string;
}

const phaseOrder: RunPhase[] = [
  "started",
  "proposed",
  "executed",
  "evaluated",
  "decision_written",
  "committed",
  "frontier_updated",
  "completed",
  "failed",
];

export function advanceRunPhase(
  run: RunRecord,
  nextPhase: RunPhase,
  options: AdvanceRunPhaseOptions = {},
): RunRecord {
  const currentIndex = phaseOrder.indexOf(run.phase);
  const nextIndex = phaseOrder.indexOf(nextPhase);

  if (nextIndex < currentIndex) {
    return runRecordSchema.parse(run);
  }

  const resolvedPhase = nextIndex === currentIndex ? run.phase : nextPhase;
  const status = options.status ?? inferStatusForPhase(run.status, resolvedPhase);
  const pendingAction = options.pendingAction ?? derivePendingAction({ ...run, status, phase: resolvedPhase });

  const updated: RunRecord = runRecordSchema.parse({
    ...run,
    status,
    phase: resolvedPhase,
    pendingAction: pendingActionSchema.parse(pendingAction),
    decisionId: options.decisionId ?? run.decisionId,
    error: options.error ?? run.error,
    endedAt: resolvedPhase === "completed" || resolvedPhase === "failed" ? options.at ?? run.endedAt ?? new Date().toISOString() : run.endedAt,
  });

  return updated;
}

export function canResume(run: RunRecord): boolean {
  return recoverRun(run).resumable;
}

export function recoverRun(run: RunRecord): RecoveryPlan {
  if (run.status === "needs_human") {
    return {
      resumable: false,
      nextAction: "none",
      reason: "run is waiting for manual review",
    };
  }

  if (run.phase === "completed") {
    return {
      resumable: false,
      nextAction: "none",
      reason: "run already completed",
    };
  }

  if (run.phase === "failed") {
    return {
      resumable: false,
      nextAction: "none",
      reason: "run failed and requires explicit intervention",
    };
  }

  const recovery = classifyRecovery({ latestRun: run });
  const nextAction = run.pendingAction !== "none"
    ? run.pendingAction
    : derivePendingAction(run);
  return {
    resumable: nextAction !== "none",
    nextAction,
    reason: recovery.classification === "repair_required"
      ? `resume from ${run.phase} with action ${nextAction}`
      : recovery.reason,
  };
}

function inferStatusForPhase(currentStatus: RunStatus, phase: RunPhase): RunStatus {
  switch (phase) {
    case "started":
    case "proposed":
    case "executed":
      return "running";
    case "evaluated":
      return currentStatus === "rejected" || currentStatus === "needs_human" || currentStatus === "accepted"
        ? currentStatus
        : "evaluated";
    case "decision_written":
    case "committed":
    case "frontier_updated":
    case "completed":
      return currentStatus;
    case "failed":
      return "failed";
  }
}
