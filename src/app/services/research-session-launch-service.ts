import { realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { JsonFileResearchSessionRepository } from "../../adapters/fs/json-file-research-session-repository.js";
import {
  DEFAULT_ALLOWED_GLOBS,
  DEFAULT_CODEX_CLI_APPROVAL_POLICY,
  DEFAULT_CODEX_CLI_SANDBOX_MODE,
  DEFAULT_PROJECT_BASELINE_REF,
  DEFAULT_SESSION_INSUFFICIENT_EVIDENCE_LIMIT,
  DEFAULT_SESSION_NO_PROGRESS_LIMIT,
  DEFAULT_SESSION_REPEATED_FAILURE_LIMIT,
  DEFAULT_STORAGE_ROOT,
  DEFAULT_TTY_SESSION_STARTUP_TIMEOUT_SEC,
  DEFAULT_TTY_SESSION_TURN_TIMEOUT_SEC,
} from "../../core/manifest/defaults.js";
import type { CodexCliSessionLifecycleRecord } from "../../core/model/codex-cli-session-lifecycle.js";
import type { ResearchProjectDefaultsRecord } from "../../core/model/research-project-defaults.js";
import type {
  ResearchSessionMetadata,
  ResearchSessionRecord,
  ResearchSessionTuiSelectedCandidateSummary,
} from "../../core/model/research-session.js";
import type {
  ResearchSessionRepository,
} from "../../core/ports/research-session-repository.js";
import type { ResearchSessionRecoveryStatus } from "../../core/state/research-session-recovery-classifier.js";
import { selectResearchSessionResumeCandidate } from "../../core/state/research-session-resume-candidate.js";
import { buildResearchSessionReviewStateFromValues } from "./research-session-draft-service.js";
import {
  mapDetectedResearchSessionToEntryFlowSummary,
  type ResumableResearchSessionStartupCandidate,
} from "./research-session-entry-flow-summary-mapper.js";
import { ResearchProjectDefaultsService } from "./research-project-defaults-service.js";
import { ResearchSessionRecoveryService } from "./research-session-recovery-service.js";

export interface ResearchSessionLaunchInput {
  goal: string;
  repoRoot: string;
}

export interface ResearchSessionLaunchResult {
  goal: string;
  repoRoot: string;
  interface: "tui";
  status: "draft_created" | "draft_refreshed";
  sessionId: string;
  sessionPath: string;
  selectedCandidateSummary?: ResearchSessionTuiSelectedCandidateSummary;
  existingSession?: ExistingResearchSessionInspection;
  resumableSession?: ResumableResearchSessionStartupCandidate;
}

export interface ExistingResearchSessionInspection {
  session: ResearchSessionRecord;
  lifecycle: CodexCliSessionLifecycleRecord | null;
  recovery: ResearchSessionRecoveryStatus;
}

export interface ResearchSessionLaunchServiceDependencies {
  now?: () => Date;
  createRepository?: (sessionsRoot: string) => ResearchSessionRepository;
  recoveryService?: Pick<ResearchSessionRecoveryService, "inspectSession">;
  createRecoveryService?: () => Pick<ResearchSessionRecoveryService, "inspectSession">;
  projectDefaultsService?: Pick<ResearchProjectDefaultsService, "loadForRepo" | "saveForSession">;
  createProjectDefaultsService?: () => Pick<
    ResearchProjectDefaultsService,
    "loadForRepo" | "saveForSession"
  >;
}

interface ResearchSessionDraftFlowState {
  permissions: {
    workingDirectory: string;
    webSearch: string;
    shellCommandAllowlistAdditions: string;
    shellCommandAllowlistRemovals: string;
    approvalPolicy: string;
    sandboxMode: string;
  };
  stopRules: {
    repeatedFailures: string;
    noMeaningfulProgress: string;
    insufficientEvidence: string;
  };
  outputs: {
    goal: string;
    trackableGlobs: string;
    baseRef: string;
    agentCommand: string;
    model: string;
    startupTimeoutSec: string;
    turnTimeoutSec: string;
  };
  review: {
    sections: {
      index: string;
      label: string;
      step: "permissions" | "stopRules" | "outputs";
      fields: {
        label: string;
        value: string;
      }[];
    }[];
  };
}

const LAUNCH_DRAFT_SESSION_ID = "launch-draft";
const LAUNCH_DISCOVERY_SESSION_STATUSES = ["running", "halted"] as const;

export class ResearchSessionLaunchService {
  private readonly now: () => Date;
  private readonly createRepository: (sessionsRoot: string) => ResearchSessionRepository;
  private readonly recoveryService: Pick<ResearchSessionRecoveryService, "inspectSession">;
  private readonly projectDefaultsService: Pick<
    ResearchProjectDefaultsService,
    "loadForRepo" | "saveForSession"
  >;

  public constructor(dependencies: ResearchSessionLaunchServiceDependencies = {}) {
    this.now = dependencies.now ?? (() => new Date());
    this.createRepository =
      dependencies.createRepository ??
      ((sessionsRoot) => new JsonFileResearchSessionRepository(sessionsRoot));
    this.recoveryService =
      dependencies.recoveryService ??
      dependencies.createRecoveryService?.() ??
      new ResearchSessionRecoveryService({
        createRepository: this.createRepository,
      });
    this.projectDefaultsService =
      dependencies.projectDefaultsService ??
      dependencies.createProjectDefaultsService?.() ??
      new ResearchProjectDefaultsService({
        ...(dependencies.now ? { now: dependencies.now } : {}),
      });
  }

  public async launch(input: ResearchSessionLaunchInput): Promise<ResearchSessionLaunchResult> {
    const goal = input.goal.trim();
    if (!goal) {
      throw new Error("Goal is required");
    }

    const repoRoot = resolve(input.repoRoot);
    const repoStats = await stat(repoRoot).catch(() => null);
    if (!repoStats?.isDirectory()) {
      throw new Error(`Working directory is not a directory: ${repoRoot}`);
    }

    const canonicalRepoRoot = await realpath(repoRoot);
    const storageRoot = join(canonicalRepoRoot, DEFAULT_STORAGE_ROOT);
    const sessionsRoot = join(storageRoot, "sessions");
    const sessionPath = join(sessionsRoot, LAUNCH_DRAFT_SESSION_ID, "session.json");
    const sessionRepository = this.createRepository(sessionsRoot);
    const existingDraft = await sessionRepository.loadSession(LAUNCH_DRAFT_SESSION_ID);
    const projectDefaults = await this.projectDefaultsService.loadForRepo(canonicalRepoRoot);
    const draft = this.buildDraftRecord({
      existingDraft,
      goal,
      projectDefaults,
      repoRoot: canonicalRepoRoot,
    });

    await sessionRepository.saveSession(draft);
    await this.projectDefaultsService.saveForSession({
      repoRoot: canonicalRepoRoot,
      session: draft,
    });
    const existingSession = await this.findExistingSession({
      goal,
      repoRoot: canonicalRepoRoot,
      repository: sessionRepository,
    });

    return {
      goal: draft.draftState?.flowState?.outputs?.goal ?? draft.draftState?.goalStep?.goal ?? draft.goal,
      repoRoot: canonicalRepoRoot,
      interface: "tui",
      status: existingDraft ? "draft_refreshed" : "draft_created",
      sessionId: draft.sessionId,
      sessionPath,
      ...(existingSession?.selectedCandidateSummary
        ? {
            selectedCandidateSummary: existingSession.selectedCandidateSummary,
          }
        : {}),
      ...(existingSession ? { existingSession } : {}),
      ...(existingSession?.resumableSession
        ? {
            resumableSession: existingSession.resumableSession,
          }
        : {}),
    };
  }

  private async findExistingSession(input: {
    goal: string;
    repoRoot: string;
    repository: ResearchSessionRepository;
  }): Promise<
    | (ExistingResearchSessionInspection & {
        selectedCandidateSummary: ResearchSessionTuiSelectedCandidateSummary;
        resumableSession?: ResumableResearchSessionStartupCandidate;
      })
    | undefined
  > {
    const sessions = await this.queryStartupSessionMetadata(input.repository, input.repoRoot);
    const candidate = selectResearchSessionResumeCandidate({
      goal: input.goal,
      sessions,
    });
    if (!candidate) {
      return undefined;
    }

    const inspection = await this.recoveryService.inspectSession({
      repoRoot: input.repoRoot,
      sessionId: candidate.sessionId,
    });
    const entryFlowSummary = mapDetectedResearchSessionToEntryFlowSummary(inspection);

    return {
      session: inspection.session,
      lifecycle: inspection.lifecycle,
      recovery: inspection.recovery,
      selectedCandidateSummary: entryFlowSummary.selectedCandidateSummary,
      ...(entryFlowSummary.resumableSession
        ? { resumableSession: entryFlowSummary.resumableSession }
        : {}),
    };
  }

  private async queryStartupSessionMetadata(
    repository: ResearchSessionRepository,
    repoRoot: string,
  ): Promise<ResearchSessionMetadata[]> {
    if (repository.querySessionMetadata) {
      return repository.querySessionMetadata({
        workingDirectory: repoRoot,
        statuses: [...LAUNCH_DISCOVERY_SESSION_STATUSES],
      });
    }

    const sessions = await repository.querySessions({
      workingDirectory: repoRoot,
      statuses: [...LAUNCH_DISCOVERY_SESSION_STATUSES],
    });

    return sessions.map((session) => ({
      sessionId: session.sessionId,
      goal: session.goal,
      workingDirectory: session.workingDirectory,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      completedCycles: session.progress.completedCycles,
      ...(session.progress.lastCheckpointAt
        ? { lastCheckpointAt: session.progress.lastCheckpointAt }
        : {}),
      resumeFromCycle: session.resume.resumeFromCycle,
    }));
  }

  private buildDraftRecord(input: {
    existingDraft: ResearchSessionRecord | null;
    goal: string;
    projectDefaults: ResearchProjectDefaultsRecord | null;
    repoRoot: string;
  }): ResearchSessionRecord {
    const timestamp = this.now().toISOString();

    return {
      sessionId: input.existingDraft?.sessionId ?? LAUNCH_DRAFT_SESSION_ID,
      goal: input.existingDraft?.goal ?? input.goal,
      workingDirectory: input.existingDraft?.workingDirectory ?? input.projectDefaults?.workingDirectory ?? input.repoRoot,
      status: "draft",
      agent: {
        type: "codex_cli",
        command: input.existingDraft?.agent.command ?? input.projectDefaults?.agent.command ?? "codex",
        ...(input.existingDraft?.agent.model ?? input.projectDefaults?.agent.model
          ? { model: input.existingDraft?.agent.model ?? input.projectDefaults?.agent.model }
          : {}),
        approvalPolicy:
          input.existingDraft?.agent.approvalPolicy ??
          input.projectDefaults?.agent.approvalPolicy ??
          DEFAULT_CODEX_CLI_APPROVAL_POLICY,
        sandboxMode:
          input.existingDraft?.agent.sandboxMode ??
          input.projectDefaults?.agent.sandboxMode ??
          DEFAULT_CODEX_CLI_SANDBOX_MODE,
        ttySession: {
          startupTimeoutSec:
            input.existingDraft?.agent.ttySession.startupTimeoutSec ??
            input.projectDefaults?.agent.ttySession.startupTimeoutSec ??
            DEFAULT_TTY_SESSION_STARTUP_TIMEOUT_SEC,
          turnTimeoutSec:
            input.existingDraft?.agent.ttySession.turnTimeoutSec ??
            input.projectDefaults?.agent.ttySession.turnTimeoutSec ??
            DEFAULT_TTY_SESSION_TURN_TIMEOUT_SEC,
        },
      },
      context: {
        trackableGlobs:
          input.existingDraft?.context.trackableGlobs ?? input.projectDefaults?.context.trackableGlobs ?? DEFAULT_ALLOWED_GLOBS,
        webSearch: input.existingDraft?.context.webSearch ?? input.projectDefaults?.context.webSearch ?? true,
        shellCommandAllowlistAdditions:
          input.existingDraft?.context.shellCommandAllowlistAdditions ??
          input.projectDefaults?.context.shellCommandAllowlistAdditions ??
          [],
        shellCommandAllowlistRemovals:
          input.existingDraft?.context.shellCommandAllowlistRemovals ??
          input.projectDefaults?.context.shellCommandAllowlistRemovals ??
          [],
      },
      workspace: {
        strategy: "git_worktree",
        ...(input.existingDraft?.workspace.baseRef
          ? { baseRef: input.existingDraft.workspace.baseRef }
          : input.projectDefaults?.workspace.baseRef
            ? { baseRef: input.projectDefaults.workspace.baseRef }
          : {}),
        promoted: false,
      },
      stopPolicy:
        input.existingDraft?.stopPolicy ??
        input.projectDefaults?.stopPolicy ?? {
          repeatedFailures: DEFAULT_SESSION_REPEATED_FAILURE_LIMIT,
          noMeaningfulProgress: DEFAULT_SESSION_NO_PROGRESS_LIMIT,
          insufficientEvidence: DEFAULT_SESSION_INSUFFICIENT_EVIDENCE_LIMIT,
        },
      progress: {
        completedCycles: 0,
        nextCycle: 1,
        latestFrontierIds: [],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
      },
      stopCondition: {
        type: "none",
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 1,
        requiresUserConfirmation: false,
      },
      draftState: buildDraftState({
        existingDraft: input.existingDraft,
        goal: input.goal,
        projectDefaults: input.projectDefaults,
        repoRoot: input.repoRoot,
      }),
      createdAt: input.existingDraft?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
  }
}

function buildDraftState(input: {
  existingDraft: ResearchSessionRecord | null;
  goal: string;
  projectDefaults: ResearchProjectDefaultsRecord | null;
  repoRoot: string;
}): NonNullable<ResearchSessionRecord["draftState"]> {
  const currentStep = input.existingDraft?.draftState?.currentStep ?? "permissions";
  const flowState = resolveDraftFlowState(input);

  return {
    currentStep,
    completedSteps: resolveCompletedSteps({
      completedSteps: input.existingDraft?.draftState?.completedSteps,
      currentStep,
    }),
    returnToReview: input.existingDraft?.draftState?.returnToReview ?? false,
    reviewConfirmed: input.existingDraft?.draftState?.reviewConfirmed ?? false,
    flowState,
    goalStep: {
      goal: flowState.outputs.goal,
      agentCommand: flowState.outputs.agentCommand,
      repeatedFailures: flowState.stopRules.repeatedFailures,
      noMeaningfulProgress: flowState.stopRules.noMeaningfulProgress,
      insufficientEvidence: flowState.stopRules.insufficientEvidence,
    },
    contextStep: {
      trackableGlobs: flowState.outputs.trackableGlobs,
      webSearch: flowState.permissions.webSearch,
      shellCommandAllowlistAdditions: flowState.permissions.shellCommandAllowlistAdditions,
      shellCommandAllowlistRemovals: flowState.permissions.shellCommandAllowlistRemovals,
    },
    workspaceStep: {
      workingDirectory: flowState.permissions.workingDirectory,
      baseRef: flowState.outputs.baseRef,
    },
    agentStep: {
      command: input.existingDraft?.draftState?.agentStep?.command ?? flowState.outputs.agentCommand,
      model: flowState.outputs.model,
      approvalPolicy: flowState.permissions.approvalPolicy,
      sandboxMode: flowState.permissions.sandboxMode,
      startupTimeoutSec: flowState.outputs.startupTimeoutSec,
      turnTimeoutSec: flowState.outputs.turnTimeoutSec,
    },
  };
}

function resolveDraftFlowState(input: {
  existingDraft: ResearchSessionRecord | null;
  goal: string;
  projectDefaults: ResearchProjectDefaultsRecord | null;
  repoRoot: string;
}): ResearchSessionDraftFlowState {
  const permissions = input.existingDraft?.draftState?.flowState?.permissions;
  const stopRules = input.existingDraft?.draftState?.flowState?.stopRules;
  const outputs = input.existingDraft?.draftState?.flowState?.outputs;
  const existingGoalStep = input.existingDraft?.draftState?.goalStep;
  const existingContextStep = input.existingDraft?.draftState?.contextStep;
  const existingWorkspaceStep = input.existingDraft?.draftState?.workspaceStep;
  const existingAgentStep = input.existingDraft?.draftState?.agentStep;
  const defaultContext = input.projectDefaults?.context;
  const defaultWorkspace = input.projectDefaults?.workspace;
  const defaultAgent = input.projectDefaults?.agent;
  const defaultStopPolicy = input.projectDefaults?.stopPolicy;

  const baseFlowState = {
    permissions: {
      workingDirectory:
        permissions?.workingDirectory ??
        existingWorkspaceStep?.workingDirectory ??
        input.existingDraft?.workingDirectory ??
        input.projectDefaults?.workingDirectory ??
        input.repoRoot,
      webSearch:
        permissions?.webSearch ??
        existingContextStep?.webSearch ??
        (input.existingDraft?.context.webSearch ?? defaultContext?.webSearch ?? true ? "enabled" : "disabled"),
      shellCommandAllowlistAdditions:
        permissions?.shellCommandAllowlistAdditions ??
        existingContextStep?.shellCommandAllowlistAdditions ??
        (input.existingDraft?.context.shellCommandAllowlistAdditions ??
          defaultContext?.shellCommandAllowlistAdditions ??
          []
        ).join(", "),
      shellCommandAllowlistRemovals:
        permissions?.shellCommandAllowlistRemovals ??
        existingContextStep?.shellCommandAllowlistRemovals ??
        (input.existingDraft?.context.shellCommandAllowlistRemovals ??
          defaultContext?.shellCommandAllowlistRemovals ??
          []
        ).join(", "),
      approvalPolicy:
        permissions?.approvalPolicy ??
        existingAgentStep?.approvalPolicy ??
        input.existingDraft?.agent.approvalPolicy ??
        defaultAgent?.approvalPolicy ??
        DEFAULT_CODEX_CLI_APPROVAL_POLICY,
      sandboxMode:
        permissions?.sandboxMode ??
        existingAgentStep?.sandboxMode ??
        input.existingDraft?.agent.sandboxMode ??
        defaultAgent?.sandboxMode ??
        DEFAULT_CODEX_CLI_SANDBOX_MODE,
    },
    stopRules: {
      repeatedFailures:
        stopRules?.repeatedFailures ??
        existingGoalStep?.repeatedFailures ??
        String(
          input.existingDraft?.stopPolicy.repeatedFailures ??
            defaultStopPolicy?.repeatedFailures ??
            DEFAULT_SESSION_REPEATED_FAILURE_LIMIT,
        ),
      noMeaningfulProgress:
        stopRules?.noMeaningfulProgress ??
        existingGoalStep?.noMeaningfulProgress ??
        String(
          input.existingDraft?.stopPolicy.noMeaningfulProgress ??
            defaultStopPolicy?.noMeaningfulProgress ??
            DEFAULT_SESSION_NO_PROGRESS_LIMIT,
        ),
      insufficientEvidence:
        stopRules?.insufficientEvidence ??
        existingGoalStep?.insufficientEvidence ??
        String(
          input.existingDraft?.stopPolicy.insufficientEvidence ??
            defaultStopPolicy?.insufficientEvidence ??
            DEFAULT_SESSION_INSUFFICIENT_EVIDENCE_LIMIT,
        ),
    },
    outputs: {
      goal: outputs?.goal ?? existingGoalStep?.goal ?? input.existingDraft?.goal ?? input.goal,
      trackableGlobs:
        outputs?.trackableGlobs ??
        existingContextStep?.trackableGlobs ??
        (input.existingDraft?.context.trackableGlobs ?? defaultContext?.trackableGlobs ?? DEFAULT_ALLOWED_GLOBS).join(", "),
      baseRef:
        outputs?.baseRef ??
        existingWorkspaceStep?.baseRef ??
        input.existingDraft?.workspace.baseRef ??
        defaultWorkspace?.baseRef ??
        DEFAULT_PROJECT_BASELINE_REF,
      agentCommand:
        outputs?.agentCommand ??
        existingGoalStep?.agentCommand ??
        existingAgentStep?.command ??
        input.existingDraft?.agent.command ??
        defaultAgent?.command ??
        "codex",
      model: outputs?.model ?? existingAgentStep?.model ?? input.existingDraft?.agent.model ?? defaultAgent?.model ?? "",
      startupTimeoutSec:
        outputs?.startupTimeoutSec ??
        existingAgentStep?.startupTimeoutSec ??
        String(
          input.existingDraft?.agent.ttySession.startupTimeoutSec ??
            defaultAgent?.ttySession.startupTimeoutSec ??
            DEFAULT_TTY_SESSION_STARTUP_TIMEOUT_SEC,
        ),
      turnTimeoutSec:
        outputs?.turnTimeoutSec ??
        existingAgentStep?.turnTimeoutSec ??
        String(
          input.existingDraft?.agent.ttySession.turnTimeoutSec ??
            defaultAgent?.ttySession.turnTimeoutSec ??
            DEFAULT_TTY_SESSION_TURN_TIMEOUT_SEC,
        ),
    },
  };

  return {
    ...baseFlowState,
    review:
      input.existingDraft?.draftState?.flowState?.review ??
      buildResearchSessionReviewStateFromValues({
        workingDirectory: baseFlowState.permissions.workingDirectory,
        webSearch: baseFlowState.permissions.webSearch,
        shellCommandAllowlistAdditions: baseFlowState.permissions.shellCommandAllowlistAdditions,
        shellCommandAllowlistRemovals: baseFlowState.permissions.shellCommandAllowlistRemovals,
        approvalPolicy: baseFlowState.permissions.approvalPolicy,
        sandboxMode: baseFlowState.permissions.sandboxMode,
        repeatedFailures: baseFlowState.stopRules.repeatedFailures,
        noMeaningfulProgress: baseFlowState.stopRules.noMeaningfulProgress,
        insufficientEvidence: baseFlowState.stopRules.insufficientEvidence,
        goal: baseFlowState.outputs.goal,
        trackableGlobs: baseFlowState.outputs.trackableGlobs,
        baseRef: baseFlowState.outputs.baseRef,
        agentCommand: baseFlowState.outputs.agentCommand,
        model: baseFlowState.outputs.model,
        startupTimeoutSec: baseFlowState.outputs.startupTimeoutSec,
        turnTimeoutSec: baseFlowState.outputs.turnTimeoutSec,
      }),
  };
}

function resolveCompletedSteps(input: {
  completedSteps: ReadonlyArray<NonNullable<ResearchSessionRecord["draftState"]>["completedSteps"][number]> | undefined;
  currentStep: NonNullable<ResearchSessionRecord["draftState"]>["currentStep"];
}): NonNullable<ResearchSessionRecord["draftState"]>["completedSteps"] {
  if (input.completedSteps && input.completedSteps.length > 0) {
    return normalizeCompletedSteps(input.completedSteps);
  }

  const currentIndex = DRAFT_STEP_ORDER.indexOf(input.currentStep);
  if (currentIndex <= 0) {
    return [];
  }

  return DRAFT_STEP_ORDER.slice(0, currentIndex);
}

function normalizeCompletedSteps(
  completedSteps: readonly NonNullable<ResearchSessionRecord["draftState"]>["completedSteps"][number][],
): NonNullable<ResearchSessionRecord["draftState"]>["completedSteps"] {
  const completed = new Set(completedSteps);
  return DRAFT_STEP_ORDER.filter((step) => completed.has(step));
}

const DRAFT_STEP_ORDER: NonNullable<ResearchSessionRecord["draftState"]>["completedSteps"] = [
  "permissions",
  "stopRules",
  "outputs",
  "review",
];
