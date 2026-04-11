import type {
  CodexCliSessionLifecyclePhase,
  CodexCliSessionLifecycleRecord,
} from "../model/codex-cli-session-lifecycle.js";
import type { ResearchSessionRecord } from "../model/research-session.js";

export type ResearchSessionRecoveryClassification =
  | "resumable"
  | "inspect_only"
  | "non_recoverable";

export type ResearchSessionRuntimeState =
  | "active"
  | "stale"
  | "exited"
  | "missing";

export interface ResearchSessionRecoveryRuntime {
  state: ResearchSessionRuntimeState;
  processAlive: boolean;
  stale: boolean;
  pid?: number;
  updatedAt?: string;
  phase?: CodexCliSessionLifecyclePhase;
}

export interface ResearchSessionRecoveryStatus {
  classification: ResearchSessionRecoveryClassification;
  resumeAllowed: boolean;
  reason: string;
  runtime: ResearchSessionRecoveryRuntime;
}

export interface ResearchSessionRecoveryClassificationInput {
  session: ResearchSessionRecord;
  lifecycle?: CodexCliSessionLifecycleRecord | null;
  processAlive?: boolean;
}

export function classifyResearchSessionRecovery(
  input: ResearchSessionRecoveryClassificationInput,
): ResearchSessionRecoveryStatus {
  const runtime = describeRuntime(input.lifecycle ?? null, input.processAlive ?? false);
  const session = input.session;

  if (session.status === "failed") {
    return createStatus({
      classification: "non_recoverable",
      reason: "session already failed with an unrecoverable Codex runtime error",
      runtime,
    });
  }

  if (session.status === "goal_achieved") {
    return createStatus({
      classification: "inspect_only",
      reason: "session already reached goal_achieved; inspect the evidence bundle instead of resuming",
      runtime,
    });
  }

  if (session.status === "draft") {
    return createStatus({
      classification: "inspect_only",
      reason: "launch draft has not started a Codex CLI session yet",
      runtime,
    });
  }

  if (session.status === "halted") {
    if (runtime.processAlive) {
      return createStatus({
        classification: "inspect_only",
        reason: "Codex CLI still appears to be running for this halted session",
        runtime,
      });
    }

    return createStatus({
      classification: "resumable",
      reason: `${describeHaltReason(session)}; continue from completed cycle boundary ${session.resume.resumeFromCycle}`,
      runtime,
    });
  }

  const lifecycle = input.lifecycle ?? null;
  if (!lifecycle) {
    return createStatus({
      classification: "inspect_only",
      reason: `${session.status} session is missing Codex lifecycle evidence`,
      runtime,
    });
  }

  const evidenceFailure = findEvidenceFailure(session, lifecycle);
  if (evidenceFailure) {
    return createStatus({
      classification: "non_recoverable",
      reason: evidenceFailure,
      runtime,
    });
  }

  if (lifecycle.phase === "startup_error" || lifecycle.phase === "runtime_error") {
    return createStatus({
      classification: "non_recoverable",
      reason: `Codex lifecycle recorded ${lifecycle.phase.replace("_", " ")}`,
      runtime,
    });
  }

  if (lifecycle.phase === "non_zero_exit") {
    return createStatus({
      classification: "non_recoverable",
      reason: `Codex CLI exited with code ${lifecycle.exit?.code ?? "unknown"} before checkpointing the interrupted cycle`,
      runtime,
    });
  }

  if (lifecycle.phase === "running" || lifecycle.phase === "starting") {
    if (runtime.processAlive) {
      return createStatus({
        classification: "inspect_only",
        reason: "Codex CLI still appears to be running for this session",
        runtime,
      });
    }

    return createStatus({
      classification: "resumable",
      reason: `Codex CLI is no longer live; resume from completed cycle boundary ${session.resume.resumeFromCycle}`,
      runtime,
    });
  }

  if (runtime.processAlive) {
    return createStatus({
      classification: "inspect_only",
      reason: `Codex lifecycle says ${lifecycle.phase} but the process still appears alive`,
      runtime,
    });
  }

  if (lifecycle.phase === "clean_exit") {
    return createStatus({
      classification: "resumable",
      reason: `Codex CLI exited cleanly before cycle ${session.resume.resumeFromCycle} completed`,
      runtime,
    });
  }

  return createStatus({
    classification: "resumable",
    reason: `Codex CLI exited from signal ${lifecycle.exit?.signal ?? "unknown"} before cycle ${session.resume.resumeFromCycle} completed`,
    runtime,
  });
}

function createStatus(input: {
  classification: ResearchSessionRecoveryClassification;
  reason: string;
  runtime: ResearchSessionRecoveryRuntime;
}): ResearchSessionRecoveryStatus {
  return {
    classification: input.classification,
    resumeAllowed: input.classification === "resumable",
    reason: input.reason,
    runtime: input.runtime,
  };
}

function describeRuntime(
  lifecycle: CodexCliSessionLifecycleRecord | null,
  processAlive: boolean,
): ResearchSessionRecoveryRuntime {
  if (!lifecycle) {
    return {
      state: "missing",
      processAlive: false,
      stale: false,
    };
  }

  const activePhase = lifecycle.phase === "starting" || lifecycle.phase === "running";
  const state = activePhase
    ? (processAlive ? "active" : "stale")
    : "exited";

  return {
    state,
    processAlive,
    stale: state === "stale",
    ...(lifecycle.pid === undefined ? {} : { pid: lifecycle.pid }),
    updatedAt: lifecycle.updatedAt,
    phase: lifecycle.phase,
  };
}

function findEvidenceFailure(
  session: ResearchSessionRecord,
  lifecycle: CodexCliSessionLifecycleRecord,
): string | null {
  if (session.sessionId !== lifecycle.sessionId) {
    return "Codex lifecycle sessionId does not match the persisted research session";
  }

  if (lifecycle.identity.researchSessionId !== session.sessionId) {
    return "Codex lifecycle identity.researchSessionId does not match the persisted research session";
  }

  if (session.workingDirectory !== lifecycle.workingDirectory) {
    return "Codex lifecycle workingDirectory does not match the persisted research session";
  }

  if (lifecycle.attachmentState.workingDirectory !== session.workingDirectory) {
    return "Codex lifecycle attachmentState.workingDirectory does not match the persisted research session";
  }

  if (session.goal !== lifecycle.goal) {
    return "Codex lifecycle goal does not match the persisted research session";
  }

  if (session.resume.resumeFromCycle !== lifecycle.resumeFromCycle) {
    return "Codex lifecycle resumeFromCycle does not match the persisted completed-cycle checkpoint";
  }

  if (session.progress.completedCycles !== lifecycle.completedCycles) {
    return "Codex lifecycle completedCycles does not match the persisted completed-cycle checkpoint";
  }

  if (session.agent.command !== lifecycle.command) {
    return "Codex lifecycle command does not match the persisted research session agent command";
  }

  if (session.agent.approvalPolicy !== lifecycle.approvalPolicy) {
    return "Codex lifecycle approval policy does not match the persisted research session";
  }

  if (session.agent.sandboxMode !== lifecycle.sandboxMode) {
    return "Codex lifecycle sandbox mode does not match the persisted research session";
  }

  if ((session.agent.model ?? undefined) !== (lifecycle.model ?? undefined)) {
    return "Codex lifecycle model override does not match the persisted research session";
  }

  if (session.agent.ttySession.startupTimeoutSec !== lifecycle.tty.startupTimeoutSec) {
    return "Codex lifecycle tty startup timeout does not match the persisted research session";
  }

  if (session.agent.ttySession.turnTimeoutSec !== lifecycle.tty.turnTimeoutSec) {
    return "Codex lifecycle tty turn timeout does not match the persisted research session";
  }

  if (session.context.trackableGlobs.join("\u0000") !== lifecycle.attachmentState.trackedGlobs.join("\u0000")) {
    return "Codex lifecycle tracked globs do not match the persisted research session";
  }

  if ((session.workspace.currentRef ?? undefined) !== (lifecycle.references.workspaceRef ?? undefined)) {
    return "Codex lifecycle workspaceRef does not match the persisted research session";
  }

  if ((session.workspace.currentPath ?? undefined) !== (lifecycle.references.workspacePath ?? undefined)) {
    return "Codex lifecycle workspacePath does not match the persisted research session";
  }

  if ((session.resume.checkpointRunId ?? session.progress.latestRunId ?? undefined) !== (lifecycle.references.checkpointRunId ?? undefined)) {
    return "Codex lifecycle checkpointRunId does not match the persisted completed-cycle checkpoint";
  }

  if ((session.resume.checkpointDecisionId ?? session.progress.latestDecisionId ?? undefined) !== (lifecycle.references.checkpointDecisionId ?? undefined)) {
    return "Codex lifecycle checkpointDecisionId does not match the persisted completed-cycle checkpoint";
  }

  if (lifecycle.phase === "clean_exit") {
    if (!lifecycle.exit) {
      return "Codex lifecycle clean_exit is missing exit metadata";
    }
    if (lifecycle.exit.code !== 0 || lifecycle.exit.signal !== null) {
      return "Codex lifecycle clean_exit must record exit code 0 and no signal";
    }
    if (!lifecycle.endedAt) {
      return "Codex lifecycle clean_exit is missing endedAt";
    }
  }

  if (lifecycle.phase === "signaled") {
    if (!lifecycle.exit?.signal) {
      return "Codex lifecycle signaled exit is missing the terminating signal";
    }
    if (!lifecycle.endedAt) {
      return "Codex lifecycle signaled exit is missing endedAt";
    }
  }

  if (lifecycle.phase === "non_zero_exit") {
    if (!lifecycle.exit) {
      return "Codex lifecycle non_zero_exit is missing exit metadata";
    }
    if (lifecycle.exit.code === null || lifecycle.exit.code === 0) {
      return "Codex lifecycle non_zero_exit must record a non-zero exit code";
    }
    if (!lifecycle.endedAt) {
      return "Codex lifecycle non_zero_exit is missing endedAt";
    }
  }

  if ((lifecycle.phase === "startup_error" || lifecycle.phase === "runtime_error") && !lifecycle.error?.message) {
    return `Codex lifecycle ${lifecycle.phase} is missing the error message`;
  }

  return null;
}

function describeHaltReason(session: ResearchSessionRecord): string {
  switch (session.stopCondition.type) {
    case "repeated_failures":
      return `session halted after ${session.stopCondition.count} repeated failures`;
    case "no_meaningful_progress":
      return `session halted after ${session.stopCondition.count} no-progress cycles`;
    case "insufficient_evidence":
      return `session halted after ${session.stopCondition.count} insufficient-evidence cycles`;
    case "operator_stop":
      return session.stopCondition.note ?? "session halted for operator review";
    default:
      return "session is halted and requires inspection before continuing";
  }
}
