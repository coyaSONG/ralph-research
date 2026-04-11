import type { CodexCliSessionLifecyclePhase, CodexCliSessionLifecycleRecord } from "../../core/model/codex-cli-session-lifecycle.js";
import type { ResearchSessionRecord } from "../../core/model/research-session.js";
import type { PersistedCodexSessionReference } from "../../core/ports/research-session-repository.js";
import type { ResearchSessionRecoveryStatus } from "../../core/state/research-session-recovery-classifier.js";
import {
  ResearchSessionRecoveryService,
  type ResearchSessionRecoveryInspection,
  type ResearchSessionRecoveryInput,
} from "./research-session-recovery-service.js";

type ReusableAttachmentPhase = Extract<CodexCliSessionLifecyclePhase, "starting" | "running">;

export type CodexCliSessionAttachability =
  | {
      mode: "attach";
      attachable: true;
      resumable: false;
      reason: string;
    }
  | {
      mode: "resume";
      attachable: false;
      resumable: true;
      reason: string;
    }
  | {
      mode: "inspect";
      attachable: false;
      resumable: false;
      reason: string;
    };

export interface CodexCliReusableAttachmentTarget {
  kind: "reusable_attachment_target";
  session: ResearchSessionRecord;
  lifecycle: CodexCliSessionLifecycleRecord & {
    phase: ReusableAttachmentPhase;
    pid: number;
    attachmentState: CodexCliSessionLifecycleRecord["attachmentState"] & { status: "bound" };
  };
  recovery: ResearchSessionRecoveryStatus;
  attachability: Extract<CodexCliSessionAttachability, { mode: "attach" }>;
  target: {
    researchSessionId: string;
    codexSessionId: string;
    pid: number;
    phase: ReusableAttachmentPhase;
    command: string;
    args: string[];
    workingDirectory: string;
    attachmentStatus: "bound";
    trackedGlobs: string[];
    extraWritableDirectories: string[];
    tty: CodexCliSessionLifecycleRecord["tty"];
    workspaceRef?: string;
    workspacePath?: string;
    checkpointRunId?: string;
    checkpointDecisionId?: string;
  };
}

export interface CodexCliStaleSessionOutcome {
  kind: "stale_session_outcome";
  session: ResearchSessionRecord;
  lifecycle: CodexCliSessionLifecycleRecord | null;
  recovery: ResearchSessionRecoveryStatus;
  attachability: Exclude<CodexCliSessionAttachability, { mode: "attach" }>;
  outcome: {
    runtimeState: ResearchSessionRecoveryStatus["runtime"]["state"];
    completedCycles: number;
    resumeFromCycle: number;
    resumable: boolean;
    reason: string;
    phase?: CodexCliSessionLifecyclePhase;
    attachmentStatus?: CodexCliSessionLifecycleRecord["attachmentState"]["status"];
  };
}

export interface CodexCliReuseExistingSessionDecision {
  decision: "reuse";
  session: ResearchSessionRecord;
  lifecycle: CodexCliSessionLifecycleRecord & {
    phase: ReusableAttachmentPhase;
    pid: number;
    attachmentState: CodexCliSessionLifecycleRecord["attachmentState"] & { status: "bound" };
  };
  recovery: ResearchSessionRecoveryStatus;
  codexSessionReference: PersistedCodexSessionReference;
  reason: string;
  reuse: CodexCliReusableAttachmentTarget["target"];
}

export interface CodexCliReplaceExistingSessionDecision {
  decision: "replace";
  session: ResearchSessionRecord;
  lifecycle: CodexCliSessionLifecycleRecord | null;
  recovery: ResearchSessionRecoveryStatus;
  codexSessionReference: PersistedCodexSessionReference | null;
  reason: string;
  replace: CodexCliStaleSessionOutcome["outcome"] & {
    attachabilityMode: Exclude<CodexCliSessionAttachability["mode"], "attach">;
  };
}

export type CodexCliSessionLifecycleServiceResult =
  | CodexCliReusableAttachmentTarget
  | CodexCliStaleSessionOutcome;

export type CodexCliSessionReuseOrReplaceDecision =
  | CodexCliReuseExistingSessionDecision
  | CodexCliReplaceExistingSessionDecision;

export interface CodexCliSessionLifecycleServiceDependencies {
  recoveryService?: Pick<ResearchSessionRecoveryService, "inspectSession">;
  createRecoveryService?: () => Pick<ResearchSessionRecoveryService, "inspectSession">;
  attachabilityValidator?: (
    inspection: ResearchSessionRecoveryInspection,
  ) => CodexCliSessionAttachability;
}

export class CodexCliSessionLifecycleService {
  private readonly recoveryService: Pick<ResearchSessionRecoveryService, "inspectSession">;
  private readonly attachabilityValidator: (
    inspection: ResearchSessionRecoveryInspection,
  ) => CodexCliSessionAttachability;

  public constructor(dependencies: CodexCliSessionLifecycleServiceDependencies = {}) {
    this.recoveryService =
      dependencies.recoveryService ??
      dependencies.createRecoveryService?.() ??
      new ResearchSessionRecoveryService();
    this.attachabilityValidator =
      dependencies.attachabilityValidator ?? validateCodexCliSessionAttachability;
  }

  public async inspectSession(
    input: ResearchSessionRecoveryInput,
  ): Promise<CodexCliSessionLifecycleServiceResult> {
    const inspection = await this.recoveryService.inspectSession(input);
    return materializeCodexCliSessionLifecycleInspection(
      inspection,
      this.attachabilityValidator(inspection),
    );
  }

  public async resolveCycleSession(
    input: ResearchSessionRecoveryInput,
  ): Promise<CodexCliSessionReuseOrReplaceDecision> {
    const inspection = await this.recoveryService.inspectSession(input);
    return resolveCodexCliSessionReuseOrReplaceDecision(
      inspection,
      this.attachabilityValidator(inspection),
    );
  }
}

export function classifyCodexCliSessionLifecycleInspection(
  inspection: ResearchSessionRecoveryInspection,
): CodexCliSessionLifecycleServiceResult {
  return materializeCodexCliSessionLifecycleInspection(
    inspection,
    validateCodexCliSessionAttachability(inspection),
  );
}

export function resolveCodexCliSessionReuseOrReplaceDecision(
  inspection: ResearchSessionRecoveryInspection,
  attachability: CodexCliSessionAttachability = validateCodexCliSessionAttachability(inspection),
): CodexCliSessionReuseOrReplaceDecision {
  const result = materializeCodexCliSessionLifecycleInspection(inspection, attachability);
  if (result.kind === "reusable_attachment_target") {
    if (!inspection.codexSessionReference) {
      throw new Error("Reusable Codex CLI attachments require a persisted Codex session reference");
    }

    return {
      decision: "reuse",
      session: result.session,
      lifecycle: result.lifecycle,
      recovery: result.recovery,
      codexSessionReference: inspection.codexSessionReference,
      reason: result.attachability.reason,
      reuse: result.target,
    };
  }

  return {
    decision: "replace",
    session: result.session,
    lifecycle: result.lifecycle,
    recovery: result.recovery,
    codexSessionReference: inspection.codexSessionReference,
    reason: result.attachability.reason,
    replace: {
      ...result.outcome,
      attachabilityMode: result.attachability.mode,
    },
  };
}

function materializeCodexCliSessionLifecycleInspection(
  inspection: ResearchSessionRecoveryInspection,
  attachability: CodexCliSessionAttachability,
): CodexCliSessionLifecycleServiceResult {
  const reusableAttachmentFailure = getReusableAttachmentFailure(inspection);

  if (attachability.mode === "attach" && isReusableAttachmentLifecycle(inspection)) {
    return buildReusableAttachmentTarget(inspection, attachability);
  }

  const safeAttachability =
    attachability.mode === "attach"
      ? deriveSafeStaleAttachability(inspection, reusableAttachmentFailure)
      : attachability;

  return buildStaleSessionOutcome(inspection, safeAttachability);
}

function buildReusableAttachmentTarget(
  inspection: ResearchSessionRecoveryInspection & {
    lifecycle: CodexCliSessionLifecycleRecord & {
      phase: ReusableAttachmentPhase;
      pid: number;
      attachmentState: CodexCliSessionLifecycleRecord["attachmentState"] & { status: "bound" };
    };
  },
  attachability: Extract<CodexCliSessionAttachability, { mode: "attach" }>,
): CodexCliReusableAttachmentTarget {
  return {
    kind: "reusable_attachment_target",
    session: inspection.session,
    lifecycle: inspection.lifecycle,
    recovery: inspection.recovery,
    attachability,
    target: {
      researchSessionId: inspection.session.sessionId,
      codexSessionId: inspection.lifecycle.identity.codexSessionId,
      pid: inspection.lifecycle.pid,
      phase: inspection.lifecycle.phase,
      command: inspection.lifecycle.command,
      args: [...inspection.lifecycle.args],
      workingDirectory: inspection.lifecycle.workingDirectory,
      attachmentStatus: "bound",
      trackedGlobs: [...inspection.lifecycle.attachmentState.trackedGlobs],
      extraWritableDirectories: [...inspection.lifecycle.attachmentState.extraWritableDirectories],
      tty: { ...inspection.lifecycle.tty },
      ...(inspection.lifecycle.references.workspaceRef
        ? { workspaceRef: inspection.lifecycle.references.workspaceRef }
        : {}),
      ...(inspection.lifecycle.references.workspacePath
        ? { workspacePath: inspection.lifecycle.references.workspacePath }
        : {}),
      ...(inspection.lifecycle.references.checkpointRunId
        ? { checkpointRunId: inspection.lifecycle.references.checkpointRunId }
        : {}),
      ...(inspection.lifecycle.references.checkpointDecisionId
        ? { checkpointDecisionId: inspection.lifecycle.references.checkpointDecisionId }
        : {}),
    },
  };
}

function buildStaleSessionOutcome(
  inspection: ResearchSessionRecoveryInspection,
  attachability: Exclude<CodexCliSessionAttachability, { mode: "attach" }>,
): CodexCliStaleSessionOutcome {
  return {
    kind: "stale_session_outcome",
    session: inspection.session,
    lifecycle: inspection.lifecycle,
    recovery: inspection.recovery,
    attachability,
    outcome: {
      runtimeState: inspection.recovery.runtime.state,
      completedCycles: inspection.session.progress.completedCycles,
      resumeFromCycle: inspection.session.resume.resumeFromCycle,
      resumable: inspection.recovery.resumeAllowed,
      reason: inspection.recovery.reason,
      ...(inspection.lifecycle ? { phase: inspection.lifecycle.phase } : {}),
      ...(inspection.lifecycle ? { attachmentStatus: inspection.lifecycle.attachmentState.status } : {}),
    },
  };
}

function deriveSafeStaleAttachability(
  inspection: ResearchSessionRecoveryInspection,
  reusableAttachmentFailure: string | null,
): Exclude<CodexCliSessionAttachability, { mode: "attach" }> {
  if (inspection.recovery.resumeAllowed) {
    return {
      mode: "resume",
      attachable: false,
      resumable: true,
      reason: inspection.recovery.reason,
    };
  }

  return {
    mode: "inspect",
    attachable: false,
    resumable: false,
    reason:
      reusableAttachmentFailure ??
      "Codex CLI session looked attachable, but the persisted lifecycle evidence was incomplete",
  };
}

export function validateCodexCliSessionAttachability(
  inspection: ResearchSessionRecoveryInspection,
): CodexCliSessionAttachability {
  const reusableAttachmentFailure = getReusableAttachmentFailure(inspection);
  if (!reusableAttachmentFailure) {
    return {
      mode: "attach",
      attachable: true,
      resumable: false,
      reason: "Codex CLI session is still live and bound to the persisted working-directory attachment",
    };
  }

  if (inspection.recovery.resumeAllowed) {
    return {
      mode: "resume",
      attachable: false,
      resumable: true,
      reason: inspection.recovery.reason,
    };
  }

  return {
    mode: "inspect",
    attachable: false,
    resumable: false,
    reason: reusableAttachmentFailure ?? inspection.recovery.reason,
  };
}

function getReusableAttachmentFailure(
  inspection: ResearchSessionRecoveryInspection,
): string | null {
  const lifecycle = inspection.lifecycle;
  if (!lifecycle) {
    return inspection.recovery.reason;
  }

  if (!inspection.codexSessionReference) {
    return "Persisted Codex session reference is missing";
  }

  if (inspection.codexSessionReference.codexSessionId !== lifecycle.identity.codexSessionId) {
    return "Persisted Codex session reference does not match the lifecycle codex session id";
  }

  if (!inspection.recovery.runtime.processAlive || inspection.recovery.runtime.state !== "active") {
    return inspection.recovery.reason;
  }

  if (lifecycle.phase !== "starting" && lifecycle.phase !== "running") {
    return `Codex CLI process is live, but lifecycle phase ${lifecycle.phase} cannot accept attachment`;
  }

  if (lifecycle.pid === undefined) {
    return "Codex CLI process is live, but the persisted lifecycle is missing the process id required for attachment";
  }

  if (lifecycle.attachmentState.status !== "bound") {
    return `Codex CLI process is live, but attachmentState.status is ${lifecycle.attachmentState.status} instead of bound`;
  }

  return null;
}

function isReusableAttachmentLifecycle(
  inspection: ResearchSessionRecoveryInspection,
): inspection is ResearchSessionRecoveryInspection & { lifecycle: CodexCliSessionLifecycleRecord & {
  phase: ReusableAttachmentPhase;
  pid: number;
  attachmentState: CodexCliSessionLifecycleRecord["attachmentState"] & { status: "bound" };
}; } {
  return getReusableAttachmentFailure(inspection) === null;
}
