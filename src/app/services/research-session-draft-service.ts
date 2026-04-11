import { realpath, stat } from "node:fs/promises";
import { realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { JsonFileResearchSessionRepository } from "../../adapters/fs/json-file-research-session-repository.js";
import {
  DEFAULT_ALLOWED_GLOBS,
  DEFAULT_CODEX_CLI_APPROVAL_POLICY,
  DEFAULT_CODEX_CLI_SANDBOX_MODE,
  DEFAULT_PROJECT_BASELINE_REF,
  DEFAULT_STORAGE_ROOT,
  DEFAULT_TTY_SESSION_STARTUP_TIMEOUT_SEC,
  DEFAULT_TTY_SESSION_TURN_TIMEOUT_SEC,
} from "../../core/manifest/defaults.js";
import type { ResearchSessionRecord } from "../../core/model/research-session.js";
import type { ResearchSessionRepository } from "../../core/ports/research-session-repository.js";
import { ResearchProjectDefaultsService } from "./research-project-defaults-service.js";

export type ResearchSessionDraftStep = "permissions" | "stopRules" | "outputs" | "review";

const DRAFT_STEP_ORDER: readonly ResearchSessionDraftStep[] = [
  "permissions",
  "stopRules",
  "outputs",
  "review",
];

export interface ResearchSessionDraft {
  sessionId: string;
  currentStep: ResearchSessionDraftStep;
  completedSteps: ResearchSessionDraftStep[];
  returnToReview: boolean;
  reviewConfirmed: boolean;
  goal: string;
  repoRoot: string;
  workingDirectory: string;
  contextSettings: {
    trackableGlobs: string;
    webSearch: string;
    shellCommandAllowlistAdditions: string;
    shellCommandAllowlistRemovals: string;
  };
  workspaceSettings: {
    baseRef: string;
  };
  agentCommand: string;
  stopPolicy: {
    repeatedFailures: string;
    noMeaningfulProgress: string;
    insufficientEvidence: string;
  };
  agentSettings: {
    model: string;
    approvalPolicy: string;
    sandboxMode: string;
    startupTimeoutSec: string;
    turnTimeoutSec: string;
  };
  reviewState: ResearchSessionReviewState;
}

export type ResearchSessionDraftValidationField =
  | "goal"
  | "repeatedFailures"
  | "noMeaningfulProgress"
  | "insufficientEvidence"
  | "trackableGlobs"
  | "webSearch"
  | "shellCommandAllowlistAdditions"
  | "shellCommandAllowlistRemovals"
  | "workingDirectory"
  | "baseRef"
  | "agentCommand"
  | "approvalPolicy"
  | "sandboxMode"
  | "startupTimeoutSec"
  | "turnTimeoutSec";

export interface ResearchSessionDraftValidationResult {
  isValid: boolean;
  fieldErrors: Partial<Record<ResearchSessionDraftValidationField, string>>;
}

export interface ResearchSessionReviewSummaryField {
  label: string;
  value: string;
}

export interface ResearchSessionReviewStateSection {
  index: string;
  label: string;
  step: Exclude<ResearchSessionDraftStep, "review">;
  fields: ResearchSessionReviewSummaryField[];
}

export interface ResearchSessionReviewState {
  sections: ResearchSessionReviewStateSection[];
}

export interface ResearchSessionReviewSummarySection extends ResearchSessionReviewStateSection {
  validation: ResearchSessionDraftValidationResult;
}

export interface ResearchSessionDraftUpdate {
  currentStep?: ResearchSessionDraftStep;
  completedSteps?: ResearchSessionDraftStep[];
  returnToReview?: boolean;
  reviewConfirmed?: boolean;
  goal?: string;
  workingDirectory?: string;
  agentCommand?: string;
  contextSettings?: Partial<ResearchSessionDraft["contextSettings"]>;
  workspaceSettings?: Partial<ResearchSessionDraft["workspaceSettings"]>;
  stopPolicy?: Partial<ResearchSessionDraft["stopPolicy"]>;
  agentSettings?: Partial<ResearchSessionDraft["agentSettings"]>;
}

export interface ResearchSessionDraftServiceDependencies {
  now?: () => Date;
  createRepository?: (sessionsRoot: string) => ResearchSessionRepository;
  projectDefaultsService?: Pick<ResearchProjectDefaultsService, "saveForSession">;
  createProjectDefaultsService?: () => Pick<ResearchProjectDefaultsService, "saveForSession">;
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
  review: ResearchSessionReviewState;
}

export interface ResearchSessionReviewStateInput {
  workingDirectory: string;
  webSearch: string;
  shellCommandAllowlistAdditions: string;
  shellCommandAllowlistRemovals: string;
  approvalPolicy: string;
  sandboxMode: string;
  repeatedFailures: string;
  noMeaningfulProgress: string;
  insufficientEvidence: string;
  goal: string;
  trackableGlobs: string;
  baseRef: string;
  agentCommand: string;
  model: string;
  startupTimeoutSec: string;
  turnTimeoutSec: string;
}

export class ResearchSessionDraftService {
  private readonly now: () => Date;
  private readonly createRepository: (sessionsRoot: string) => ResearchSessionRepository;
  private readonly projectDefaultsService: Pick<ResearchProjectDefaultsService, "saveForSession">;

  public constructor(dependencies: ResearchSessionDraftServiceDependencies = {}) {
    this.now = dependencies.now ?? (() => new Date());
    this.createRepository =
      dependencies.createRepository ??
      ((sessionsRoot) => new JsonFileResearchSessionRepository(sessionsRoot));
    this.projectDefaultsService =
      dependencies.projectDefaultsService ??
      dependencies.createProjectDefaultsService?.() ??
      new ResearchProjectDefaultsService({
        ...(dependencies.now ? { now: dependencies.now } : {}),
      });
  }

  public async loadDraft(input: {
    repoRoot: string;
    sessionId: string;
  }): Promise<ResearchSessionDraft> {
    const { canonicalRepoRoot, repository } = await this.resolveRepository(input.repoRoot);
    const record = await repository.loadSession(input.sessionId);

    return mapDraftRecord({
      record,
      sessionId: input.sessionId,
      repoRoot: canonicalRepoRoot,
    });
  }

  public async updateDraft(input: {
    repoRoot: string;
    sessionId: string;
    patch: ResearchSessionDraftUpdate;
  }): Promise<ResearchSessionDraft> {
    const { canonicalRepoRoot, repository } = await this.resolveRepository(input.repoRoot);
    const existingRecord = await repository.loadSession(input.sessionId);
    const record = mapDraftRecord({
      record: existingRecord,
      sessionId: input.sessionId,
      repoRoot: canonicalRepoRoot,
    });
    const nextFlowState = buildDraftFlowState({
      draft: record,
      patch: input.patch,
    });

    const nextRecord: ResearchSessionRecord = {
      ...existingRecord!,
      goal: resolveGoal({
        patch: input.patch.goal,
        current: existingRecord!.goal,
      }),
      workingDirectory: resolveWorkingDirectoryDraft({
        patch: input.patch.workingDirectory,
        current: existingRecord!.workingDirectory,
        repoRoot: canonicalRepoRoot,
      }),
      context: {
        ...existingRecord!.context,
        trackableGlobs: resolvePatternListDraft({
          patch: input.patch.contextSettings?.trackableGlobs,
          current: existingRecord!.context.trackableGlobs,
          label: "Trackable files",
        }),
        webSearch: resolveBooleanDraft({
          patch: input.patch.contextSettings?.webSearch,
          current: existingRecord!.context.webSearch,
          label: "Web search",
        }),
        shellCommandAllowlistAdditions: resolveStringListDraft({
          patch: input.patch.contextSettings?.shellCommandAllowlistAdditions,
          current: existingRecord!.context.shellCommandAllowlistAdditions,
        }),
        shellCommandAllowlistRemovals: resolveStringListDraft({
          patch: input.patch.contextSettings?.shellCommandAllowlistRemovals,
          current: existingRecord!.context.shellCommandAllowlistRemovals,
        }),
      },
      workspace: {
        ...existingRecord!.workspace,
        baseRef: resolveRequiredDraftString({
          patch: input.patch.workspaceSettings?.baseRef,
          current: existingRecord!.workspace.baseRef ?? DEFAULT_PROJECT_BASELINE_REF,
          label: "Baseline ref",
        }),
      },
      agent: {
        ...existingRecord!.agent,
        command: resolveRequiredDraftString({
          patch: input.patch.agentCommand,
          current: existingRecord!.agent.command,
          label: "Agent command",
        }),
        model: resolveOptionalDraftString({
          patch: input.patch.agentSettings?.model,
          current: existingRecord!.agent.model,
        }),
        approvalPolicy: resolveEnumDraft({
          patch: input.patch.agentSettings?.approvalPolicy,
          current: existingRecord!.agent.approvalPolicy,
          options: ["never", "on-failure", "on-request", "untrusted"],
        }),
        sandboxMode: resolveEnumDraft({
          patch: input.patch.agentSettings?.sandboxMode,
          current: existingRecord!.agent.sandboxMode,
          options: ["read-only", "workspace-write", "danger-full-access"],
        }),
        ttySession: {
          startupTimeoutSec: resolvePositiveIntegerDraft({
            patch: input.patch.agentSettings?.startupTimeoutSec,
            current: existingRecord!.agent.ttySession.startupTimeoutSec,
            label: "Agent startup timeout",
          }),
          turnTimeoutSec: resolvePositiveIntegerDraft({
            patch: input.patch.agentSettings?.turnTimeoutSec,
            current: existingRecord!.agent.ttySession.turnTimeoutSec,
            label: "Agent turn timeout",
          }),
        },
      },
      stopPolicy: {
        repeatedFailures: resolvePositiveIntegerDraft({
          patch: input.patch.stopPolicy?.repeatedFailures,
          current: existingRecord!.stopPolicy.repeatedFailures,
          label: "Repeated failures threshold",
        }),
        noMeaningfulProgress: resolvePositiveIntegerDraft({
          patch: input.patch.stopPolicy?.noMeaningfulProgress,
          current: existingRecord!.stopPolicy.noMeaningfulProgress,
          label: "No-progress threshold",
        }),
        insufficientEvidence: resolvePositiveIntegerDraft({
          patch: input.patch.stopPolicy?.insufficientEvidence,
          current: existingRecord!.stopPolicy.insufficientEvidence,
          label: "Insufficient-evidence threshold",
        }),
      },
      draftState: {
        currentStep: input.patch.currentStep ?? record.currentStep,
        completedSteps: normalizeCompletedSteps(input.patch.completedSteps ?? record.completedSteps),
        returnToReview: input.patch.returnToReview ?? record.returnToReview,
        reviewConfirmed: resolveReviewConfirmation({
          current: record.reviewConfirmed,
          currentStep: record.currentStep,
          patch: input.patch,
        }),
        flowState: nextFlowState,
        goalStep: {
          goal: nextFlowState.outputs.goal,
          agentCommand: nextFlowState.outputs.agentCommand,
          repeatedFailures: nextFlowState.stopRules.repeatedFailures,
          noMeaningfulProgress: nextFlowState.stopRules.noMeaningfulProgress,
          insufficientEvidence: nextFlowState.stopRules.insufficientEvidence,
        },
        contextStep: {
          trackableGlobs: nextFlowState.outputs.trackableGlobs,
          webSearch: nextFlowState.permissions.webSearch,
          shellCommandAllowlistAdditions: nextFlowState.permissions.shellCommandAllowlistAdditions,
          shellCommandAllowlistRemovals: nextFlowState.permissions.shellCommandAllowlistRemovals,
        },
        workspaceStep: {
          workingDirectory: nextFlowState.permissions.workingDirectory,
          baseRef: nextFlowState.outputs.baseRef,
        },
        agentStep: {
          command: nextFlowState.outputs.agentCommand,
          model: nextFlowState.outputs.model,
          approvalPolicy: nextFlowState.permissions.approvalPolicy,
          sandboxMode: nextFlowState.permissions.sandboxMode,
          startupTimeoutSec: nextFlowState.outputs.startupTimeoutSec,
          turnTimeoutSec: nextFlowState.outputs.turnTimeoutSec,
        },
      },
      updatedAt: this.now().toISOString(),
    };

    await repository.saveSession(nextRecord);
    await this.projectDefaultsService.saveForSession({
      repoRoot: canonicalRepoRoot,
      session: nextRecord,
    });

    return mapDraftRecord({
      record: nextRecord,
      sessionId: nextRecord.sessionId,
      repoRoot: canonicalRepoRoot,
    });
  }

  private async resolveRepository(repoRoot: string): Promise<{
    canonicalRepoRoot: string;
    repository: ResearchSessionRepository;
  }> {
    const resolvedRoot = resolve(repoRoot);
    const repoStats = await stat(resolvedRoot).catch(() => null);
    if (!repoStats?.isDirectory()) {
      throw new Error(`Working directory is not a directory: ${resolvedRoot}`);
    }

    const canonicalRepoRoot = await realpath(resolvedRoot);
    const storageRoot = join(canonicalRepoRoot, DEFAULT_STORAGE_ROOT);
    const sessionsRoot = join(storageRoot, "sessions");

    return {
      canonicalRepoRoot,
      repository: this.createRepository(sessionsRoot),
    };
  }
}

export function validateGoalStepDraft(
  draft: ResearchSessionDraft,
): ResearchSessionDraftValidationResult {
  const fieldErrors: ResearchSessionDraftValidationResult["fieldErrors"] = {};

  captureValidationError(() => normalizeRequiredString(draft.goal, "Goal"), (message) => {
    fieldErrors.goal = message;
  });
  captureValidationError(
    () => normalizePositiveInteger(draft.stopPolicy.repeatedFailures, "Repeated failures threshold"),
    (message) => {
      fieldErrors.repeatedFailures = message;
    },
  );
  captureValidationError(
    () => normalizePositiveInteger(draft.stopPolicy.noMeaningfulProgress, "No-progress threshold"),
    (message) => {
      fieldErrors.noMeaningfulProgress = message;
    },
  );
  captureValidationError(
    () => normalizePositiveInteger(draft.stopPolicy.insufficientEvidence, "Insufficient-evidence threshold"),
    (message) => {
      fieldErrors.insufficientEvidence = message;
    },
  );

  return {
    isValid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}

export function validateContextStepDraft(
  draft: ResearchSessionDraft,
): ResearchSessionDraftValidationResult {
  const fieldErrors: ResearchSessionDraftValidationResult["fieldErrors"] = {};

  captureValidationError(
    () => normalizePatternList(draft.contextSettings.trackableGlobs, "Trackable files"),
    (message) => {
      fieldErrors.trackableGlobs = message;
    },
  );
  captureValidationError(
    () => normalizeBooleanChoice(draft.contextSettings.webSearch, "Web search"),
    (message) => {
      fieldErrors.webSearch = message;
    },
  );
  captureValidationError(
    () =>
      normalizeOptionalStringList(
        draft.contextSettings.shellCommandAllowlistAdditions,
        "Shell allowlist additions",
      ),
    (message) => {
      fieldErrors.shellCommandAllowlistAdditions = message;
    },
  );
  captureValidationError(
    () =>
      normalizeOptionalStringList(
        draft.contextSettings.shellCommandAllowlistRemovals,
        "Shell allowlist removals",
      ),
    (message) => {
      fieldErrors.shellCommandAllowlistRemovals = message;
    },
  );

  return {
    isValid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}

export function validateWorkspaceStepDraft(
  draft: ResearchSessionDraft,
): ResearchSessionDraftValidationResult {
  const fieldErrors: ResearchSessionDraftValidationResult["fieldErrors"] = {};

  captureValidationError(
    () => normalizeWorkspaceDirectory(draft.workingDirectory, "Working directory", draft.repoRoot),
    (message) => {
      fieldErrors.workingDirectory = message;
    },
  );
  captureValidationError(
    () => normalizeRequiredString(draft.workspaceSettings.baseRef, "Baseline ref"),
    (message) => {
      fieldErrors.baseRef = message;
    },
  );

  return {
    isValid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}

export function validateAgentStepDraft(
  draft: ResearchSessionDraft,
): ResearchSessionDraftValidationResult {
  const fieldErrors: ResearchSessionDraftValidationResult["fieldErrors"] = {};

  captureValidationError(() => normalizeRequiredString(draft.agentCommand, "Agent command"), (message) => {
    fieldErrors.agentCommand = message;
  });
  captureValidationError(
    () =>
      normalizeEnum(
        draft.agentSettings.approvalPolicy,
        ["never", "on-failure", "on-request", "untrusted"],
        "Approval policy",
      ),
    (message) => {
      fieldErrors.approvalPolicy = message;
    },
  );
  captureValidationError(
    () =>
      normalizeEnum(
        draft.agentSettings.sandboxMode,
        ["read-only", "workspace-write", "danger-full-access"],
        "Sandbox mode",
      ),
    (message) => {
      fieldErrors.sandboxMode = message;
    },
  );
  captureValidationError(
    () => normalizePositiveInteger(draft.agentSettings.startupTimeoutSec, "Agent startup timeout"),
    (message) => {
      fieldErrors.startupTimeoutSec = message;
    },
  );
  captureValidationError(
    () => normalizePositiveInteger(draft.agentSettings.turnTimeoutSec, "Agent turn timeout"),
    (message) => {
      fieldErrors.turnTimeoutSec = message;
    },
  );

  return {
    isValid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}

export function validatePermissionsStepDraft(
  draft: ResearchSessionDraft,
): ResearchSessionDraftValidationResult {
  const workspaceValidation = validateWorkspaceStepDraft(draft);
  const contextValidation = validateContextStepDraft(draft);
  const agentValidation = validateAgentStepDraft(draft);

  const fieldErrors: ResearchSessionDraftValidationResult["fieldErrors"] = {
    ...pickValidationFields(workspaceValidation, ["workingDirectory"]),
    ...pickValidationFields(contextValidation, [
      "webSearch",
      "shellCommandAllowlistAdditions",
      "shellCommandAllowlistRemovals",
    ]),
    ...pickValidationFields(agentValidation, ["approvalPolicy", "sandboxMode"]),
  };

  return {
    isValid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}

export function validateStopRulesStepDraft(
  draft: ResearchSessionDraft,
): ResearchSessionDraftValidationResult {
  const goalValidation = validateGoalStepDraft(draft);
  const fieldErrors = pickValidationFields(goalValidation, [
    "repeatedFailures",
    "noMeaningfulProgress",
    "insufficientEvidence",
  ]);

  return {
    isValid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}

export function validateOutputsStepDraft(
  draft: ResearchSessionDraft,
): ResearchSessionDraftValidationResult {
  const goalValidation = validateGoalStepDraft(draft);
  const workspaceValidation = validateWorkspaceStepDraft(draft);
  const contextValidation = validateContextStepDraft(draft);
  const agentValidation = validateAgentStepDraft(draft);

  const fieldErrors: ResearchSessionDraftValidationResult["fieldErrors"] = {
    ...pickValidationFields(goalValidation, ["goal"]),
    ...pickValidationFields(workspaceValidation, ["baseRef"]),
    ...pickValidationFields(contextValidation, ["trackableGlobs"]),
    ...pickValidationFields(agentValidation, ["agentCommand", "startupTimeoutSec", "turnTimeoutSec"]),
  };

  return {
    isValid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}

export function validateReviewStepDraft(
  draft: ResearchSessionDraft,
): ResearchSessionDraftValidationResult {
  const validations = [
    validatePermissionsStepDraft(draft),
    validateStopRulesStepDraft(draft),
    validateOutputsStepDraft(draft),
  ];
  const fieldErrors = validations.reduce<ResearchSessionDraftValidationResult["fieldErrors"]>(
    (combined, validation) => ({
      ...combined,
      ...validation.fieldErrors,
    }),
    {},
  );

  return {
    isValid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}

export function buildResearchSessionReviewSummary(
  draft: ResearchSessionDraft,
): ResearchSessionReviewSummarySection[] {
  return draft.reviewState.sections.map((section) => ({
    ...section,
    validation: validateResearchSessionReviewSection(draft, section.step),
  }));
}

export function buildResearchSessionReviewState(
  draft: Pick<
    ResearchSessionDraft,
    "workingDirectory" | "contextSettings" | "agentSettings" | "stopPolicy" | "goal" | "workspaceSettings" | "agentCommand"
  >,
): ResearchSessionReviewState {
  return buildResearchSessionReviewStateFromValues({
    workingDirectory: draft.workingDirectory,
    webSearch: draft.contextSettings.webSearch,
    shellCommandAllowlistAdditions: draft.contextSettings.shellCommandAllowlistAdditions,
    shellCommandAllowlistRemovals: draft.contextSettings.shellCommandAllowlistRemovals,
    approvalPolicy: draft.agentSettings.approvalPolicy,
    sandboxMode: draft.agentSettings.sandboxMode,
    repeatedFailures: draft.stopPolicy.repeatedFailures,
    noMeaningfulProgress: draft.stopPolicy.noMeaningfulProgress,
    insufficientEvidence: draft.stopPolicy.insufficientEvidence,
    goal: draft.goal,
    trackableGlobs: draft.contextSettings.trackableGlobs,
    baseRef: draft.workspaceSettings.baseRef,
    agentCommand: draft.agentCommand,
    model: draft.agentSettings.model,
    startupTimeoutSec: draft.agentSettings.startupTimeoutSec,
    turnTimeoutSec: draft.agentSettings.turnTimeoutSec,
  });
}

export function buildResearchSessionReviewStateFromValues(
  input: ResearchSessionReviewStateInput,
): ResearchSessionReviewState {
  return {
    sections: [
      {
        index: "1",
        label: "Permissions",
        step: "permissions",
        fields: [
          { label: "Working directory", value: input.workingDirectory },
          { label: "Web search", value: input.webSearch },
          { label: "Shell allowlist additions", value: input.shellCommandAllowlistAdditions },
          { label: "Shell allowlist removals", value: input.shellCommandAllowlistRemovals },
          { label: "Approval policy", value: input.approvalPolicy },
          { label: "Sandbox mode", value: input.sandboxMode },
        ],
      },
      {
        index: "2",
        label: "Stop Rules",
        step: "stopRules",
        fields: [
          { label: "Repeated failures threshold", value: input.repeatedFailures },
          { label: "No-progress threshold", value: input.noMeaningfulProgress },
          { label: "Insufficient-evidence threshold", value: input.insufficientEvidence },
        ],
      },
      {
        index: "3",
        label: "Outputs",
        step: "outputs",
        fields: [
          { label: "Goal", value: input.goal },
          { label: "Trackable files", value: input.trackableGlobs },
          { label: "Baseline ref", value: input.baseRef },
          { label: "Agent command", value: input.agentCommand },
          { label: "Model override", value: input.model },
          { label: "Startup timeout (sec)", value: input.startupTimeoutSec },
          { label: "Turn timeout (sec)", value: input.turnTimeoutSec },
        ],
      },
    ],
  };
}

function mapDraftRecord(input: {
  record: ResearchSessionRecord | null;
  sessionId: string;
  repoRoot: string;
}): ResearchSessionDraft {
  if (!input.record) {
    throw new Error(`Draft session not found: ${input.sessionId}`);
  }

  if (input.record.status !== "draft") {
    throw new Error(`Session ${input.sessionId} is not editable from the launch draft TUI`);
  }

  const flowState = resolveDraftFlowState(input.record);

  return {
    sessionId: input.record.sessionId,
    currentStep: normalizeDraftStep(input.record.draftState?.currentStep),
    completedSteps: resolveCompletedSteps({
      completedSteps: input.record.draftState?.completedSteps,
      currentStep: input.record.draftState?.currentStep,
    }),
    returnToReview: input.record.draftState?.returnToReview ?? false,
    reviewConfirmed: input.record.draftState?.reviewConfirmed ?? false,
    goal: flowState.outputs.goal,
    repoRoot: input.repoRoot,
    contextSettings: {
      trackableGlobs: flowState.outputs.trackableGlobs,
      webSearch: flowState.permissions.webSearch,
      shellCommandAllowlistAdditions: flowState.permissions.shellCommandAllowlistAdditions,
      shellCommandAllowlistRemovals: flowState.permissions.shellCommandAllowlistRemovals,
    },
    workingDirectory: flowState.permissions.workingDirectory,
    workspaceSettings: {
      baseRef: flowState.outputs.baseRef,
    },
    agentCommand: flowState.outputs.agentCommand,
    stopPolicy: {
      repeatedFailures: flowState.stopRules.repeatedFailures,
      noMeaningfulProgress: flowState.stopRules.noMeaningfulProgress,
      insufficientEvidence: flowState.stopRules.insufficientEvidence,
    },
    agentSettings: {
      model: flowState.outputs.model,
      approvalPolicy: flowState.permissions.approvalPolicy,
      sandboxMode: flowState.permissions.sandboxMode,
      startupTimeoutSec: flowState.outputs.startupTimeoutSec,
      turnTimeoutSec: flowState.outputs.turnTimeoutSec,
    },
    reviewState: flowState.review,
  };
}

function buildDraftFlowState(input: {
  draft: ResearchSessionDraft;
  patch: ResearchSessionDraftUpdate;
}): ResearchSessionDraftFlowState {
  const baseFlowState = {
    permissions: {
      workingDirectory: input.patch.workingDirectory ?? input.draft.workingDirectory,
      webSearch: input.patch.contextSettings?.webSearch ?? input.draft.contextSettings.webSearch,
      shellCommandAllowlistAdditions:
        input.patch.contextSettings?.shellCommandAllowlistAdditions ??
        input.draft.contextSettings.shellCommandAllowlistAdditions,
      shellCommandAllowlistRemovals:
        input.patch.contextSettings?.shellCommandAllowlistRemovals ??
        input.draft.contextSettings.shellCommandAllowlistRemovals,
      approvalPolicy: input.patch.agentSettings?.approvalPolicy ?? input.draft.agentSettings.approvalPolicy,
      sandboxMode: input.patch.agentSettings?.sandboxMode ?? input.draft.agentSettings.sandboxMode,
    },
    stopRules: {
      repeatedFailures: input.patch.stopPolicy?.repeatedFailures ?? input.draft.stopPolicy.repeatedFailures,
      noMeaningfulProgress:
        input.patch.stopPolicy?.noMeaningfulProgress ?? input.draft.stopPolicy.noMeaningfulProgress,
      insufficientEvidence:
        input.patch.stopPolicy?.insufficientEvidence ?? input.draft.stopPolicy.insufficientEvidence,
    },
    outputs: {
      goal: input.patch.goal ?? input.draft.goal,
      trackableGlobs:
        input.patch.contextSettings?.trackableGlobs ?? input.draft.contextSettings.trackableGlobs,
      baseRef: input.patch.workspaceSettings?.baseRef ?? input.draft.workspaceSettings.baseRef,
      agentCommand: input.patch.agentCommand ?? input.draft.agentCommand,
      model: input.patch.agentSettings?.model ?? input.draft.agentSettings.model,
      startupTimeoutSec:
        input.patch.agentSettings?.startupTimeoutSec ?? input.draft.agentSettings.startupTimeoutSec,
      turnTimeoutSec: input.patch.agentSettings?.turnTimeoutSec ?? input.draft.agentSettings.turnTimeoutSec,
    },
  };

  return {
    ...baseFlowState,
    review: buildResearchSessionReviewStateFromValues({
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

function resolveReviewConfirmation(input: {
  current: boolean;
  currentStep: ResearchSessionDraftStep;
  patch: ResearchSessionDraftUpdate;
}): boolean {
  if (input.patch.reviewConfirmed !== undefined) {
    return input.patch.reviewConfirmed;
  }

  if (input.patch.currentStep !== undefined && input.patch.currentStep !== input.currentStep) {
    return false;
  }

  if (patchTouchesReviewInputs(input.patch)) {
    return false;
  }

  return input.current;
}

function patchTouchesReviewInputs(patch: ResearchSessionDraftUpdate): boolean {
  if (patch.goal !== undefined || patch.workingDirectory !== undefined || patch.agentCommand !== undefined) {
    return true;
  }

  if (patch.contextSettings && Object.values(patch.contextSettings).some((value) => value !== undefined)) {
    return true;
  }

  if (patch.workspaceSettings && Object.values(patch.workspaceSettings).some((value) => value !== undefined)) {
    return true;
  }

  if (patch.stopPolicy && Object.values(patch.stopPolicy).some((value) => value !== undefined)) {
    return true;
  }

  if (patch.agentSettings && Object.values(patch.agentSettings).some((value) => value !== undefined)) {
    return true;
  }

  return false;
}

function resolveDraftFlowState(record: ResearchSessionRecord): ResearchSessionDraftFlowState {
  const permissions = record.draftState?.flowState?.permissions;
  const stopRules = record.draftState?.flowState?.stopRules;
  const outputs = record.draftState?.flowState?.outputs;
  const baseFlowState = {
    permissions: {
      workingDirectory:
        permissions?.workingDirectory ??
        record.draftState?.workspaceStep?.workingDirectory ??
        record.workingDirectory,
      webSearch:
        permissions?.webSearch ??
        record.draftState?.contextStep?.webSearch ??
        formatBooleanChoice(record.context.webSearch),
      shellCommandAllowlistAdditions:
        permissions?.shellCommandAllowlistAdditions ??
        record.draftState?.contextStep?.shellCommandAllowlistAdditions ??
        record.context.shellCommandAllowlistAdditions.join(", "),
      shellCommandAllowlistRemovals:
        permissions?.shellCommandAllowlistRemovals ??
        record.draftState?.contextStep?.shellCommandAllowlistRemovals ??
        record.context.shellCommandAllowlistRemovals.join(", "),
      approvalPolicy:
        permissions?.approvalPolicy ??
        record.draftState?.agentStep?.approvalPolicy ??
        record.agent.approvalPolicy,
      sandboxMode:
        permissions?.sandboxMode ??
        record.draftState?.agentStep?.sandboxMode ??
        record.agent.sandboxMode,
    },
    stopRules: {
      repeatedFailures:
        stopRules?.repeatedFailures ??
        record.draftState?.goalStep?.repeatedFailures ??
        String(record.stopPolicy.repeatedFailures),
      noMeaningfulProgress:
        stopRules?.noMeaningfulProgress ??
        record.draftState?.goalStep?.noMeaningfulProgress ??
        String(record.stopPolicy.noMeaningfulProgress),
      insufficientEvidence:
        stopRules?.insufficientEvidence ??
        record.draftState?.goalStep?.insufficientEvidence ??
        String(record.stopPolicy.insufficientEvidence),
    },
    outputs: {
      goal: outputs?.goal ?? record.draftState?.goalStep?.goal ?? record.goal,
      trackableGlobs:
        outputs?.trackableGlobs ??
        record.draftState?.contextStep?.trackableGlobs ??
        record.context.trackableGlobs.join(", "),
      baseRef:
        outputs?.baseRef ??
        record.draftState?.workspaceStep?.baseRef ??
        record.workspace.baseRef ??
        DEFAULT_PROJECT_BASELINE_REF,
      agentCommand:
        outputs?.agentCommand ??
        record.draftState?.goalStep?.agentCommand ??
        record.draftState?.agentStep?.command ??
        record.agent.command,
      model: outputs?.model ?? record.draftState?.agentStep?.model ?? record.agent.model ?? "",
      startupTimeoutSec:
        outputs?.startupTimeoutSec ??
        record.draftState?.agentStep?.startupTimeoutSec ??
        String(record.agent.ttySession.startupTimeoutSec),
      turnTimeoutSec:
        outputs?.turnTimeoutSec ??
        record.draftState?.agentStep?.turnTimeoutSec ??
        String(record.agent.ttySession.turnTimeoutSec),
    },
  };

  return {
    ...baseFlowState,
    review:
      record.draftState?.flowState?.review ??
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

function normalizeDraftStep(value: string | undefined): ResearchSessionDraftStep {
  if (value === "permissions") {
    return "permissions";
  }
  if (value === "stopRules") {
    return "stopRules";
  }
  if (value === "outputs") {
    return "outputs";
  }
  if (value === "review") {
    return "review";
  }
  if (value === "agent") {
    return "outputs";
  }
  return "permissions";
}

function resolveCompletedSteps(input: {
  completedSteps: readonly string[] | undefined;
  currentStep: string | undefined;
}): ResearchSessionDraftStep[] {
  if (input.completedSteps && input.completedSteps.length > 0) {
    return normalizeCompletedSteps(input.completedSteps);
  }

  const currentStep = normalizeDraftStep(input.currentStep);
  const currentIndex = DRAFT_STEP_ORDER.indexOf(currentStep);
  if (currentIndex <= 0) {
    return [];
  }

  return DRAFT_STEP_ORDER.slice(0, currentIndex);
}

function normalizeCompletedSteps(value: readonly string[]): ResearchSessionDraftStep[] {
  const completed = new Set(value.map((step) => normalizeDraftStep(step)));
  return DRAFT_STEP_ORDER.filter((step) => completed.has(step));
}

function pickValidationFields(
  validation: ResearchSessionDraftValidationResult,
  fields: readonly ResearchSessionDraftValidationField[],
): ResearchSessionDraftValidationResult["fieldErrors"] {
  const fieldErrors: ResearchSessionDraftValidationResult["fieldErrors"] = {};

  for (const field of fields) {
    const message = validation.fieldErrors[field];
    if (message) {
      fieldErrors[field] = message;
    }
  }

  return fieldErrors;
}

function validateResearchSessionReviewSection(
  draft: ResearchSessionDraft,
  step: Exclude<ResearchSessionDraftStep, "review">,
): ResearchSessionDraftValidationResult {
  switch (step) {
    case "permissions":
      return validatePermissionsStepDraft(draft);
    case "stopRules":
      return validateStopRulesStepDraft(draft);
    case "outputs":
      return validateOutputsStepDraft(draft);
  }
}

function normalizeRequiredString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function normalizeWorkspaceDirectory(
  value: string,
  label: string,
  repoRoot: string,
): string {
  const normalized = normalizeRequiredString(value, label);
  const resolvedPath = resolve(repoRoot, normalized);
  let directoryStats: ReturnType<typeof statSync>;
  try {
    directoryStats = statSync(resolvedPath);
  } catch {
    throw new Error(`${label} does not exist`);
  }
  if (!directoryStats.isDirectory()) {
    throw new Error(`${label} is not a directory`);
  }

  const repoRealPath = realpathSync(repoRoot);
  const directoryRealPath = realpathSync(resolvedPath);
  const repoRelativePath = relative(repoRealPath, directoryRealPath);
  if (repoRelativePath.startsWith("..") || repoRelativePath === "..") {
    throw new Error(`${label} must stay within the repo root`);
  }

  return directoryRealPath;
}

function normalizePatternList(value: string, label: string): string[] {
  const normalizedPatterns = value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (normalizedPatterns.length === 0) {
    throw new Error(`${label} must include at least one pattern`);
  }

  return normalizedPatterns.map((pattern) => normalizeWorkspaceRelativePattern(pattern, label));
}

function normalizeWorkspaceRelativePattern(value: string, label: string): string {
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new Error(`${label} must stay within the working directory`);
  }

  const segments = value.split(/[\\/]+/).filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0 || segments.includes("..")) {
    throw new Error(`${label} must stay within the working directory`);
  }

  return value;
}

function normalizeOptionalStringList(value: string, _label: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function normalizeEnum<T extends string>(
  value: string,
  options: readonly T[],
  label: string,
): T {
  const normalized = value.trim();
  const match = options.find((option) => option === normalized);
  if (!match) {
    throw new Error(`${label} must be one of: ${options.join(", ")}`);
  }
  return match;
}

function normalizeBooleanChoice(value: string, label: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["enabled", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["disabled", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`${label} must be enabled or disabled`);
}

function formatBooleanChoice(value: boolean): string {
  return value ? "enabled" : "disabled";
}

function resolveGoal(input: {
  patch: string | undefined;
  current: string;
}): string {
  if (input.patch === undefined) {
    return input.current;
  }

  try {
    return normalizeRequiredString(input.patch, "Goal");
  } catch {
    return input.current;
  }
}

function resolveWorkingDirectoryDraft(input: {
  patch: string | undefined;
  current: string;
  repoRoot: string;
}): string {
  if (input.patch === undefined) {
    return input.current;
  }

  try {
    return normalizeWorkspaceDirectory(input.patch, "Working directory", input.repoRoot);
  } catch {
    return input.current;
  }
}

function resolveRequiredDraftString(input: {
  patch: string | undefined;
  current: string;
  label: string;
}): string {
  if (input.patch === undefined) {
    return input.current;
  }

  try {
    return normalizeRequiredString(input.patch, input.label);
  } catch {
    return input.current;
  }
}

function resolveOptionalDraftString(input: {
  patch: string | undefined;
  current: string | undefined;
}): string | undefined {
  if (input.patch === undefined) {
    return input.current;
  }

  const normalized = input.patch.trim();
  return normalized ? normalized : undefined;
}

function resolvePositiveIntegerDraft(input: {
  patch: string | undefined;
  current: number;
  label: string;
}): number {
  if (input.patch === undefined) {
    return input.current;
  }

  try {
    return normalizePositiveInteger(input.patch, input.label);
  } catch {
    return input.current;
  }
}

function resolveEnumDraft<T extends string>(input: {
  patch: string | undefined;
  current: T;
  options: readonly T[];
}): T {
  if (input.patch === undefined) {
    return input.current;
  }

  try {
    return normalizeEnum(input.patch, input.options, "Selection");
  } catch {
    return input.current;
  }
}

function resolvePatternListDraft(input: {
  patch: string | undefined;
  current: string[];
  label: string;
}): string[] {
  if (input.patch === undefined) {
    return input.current;
  }

  try {
    return normalizePatternList(input.patch, input.label);
  } catch {
    return input.current;
  }
}

function resolveStringListDraft(input: {
  patch: string | undefined;
  current: string[];
}): string[] {
  if (input.patch === undefined) {
    return input.current;
  }

  return normalizeOptionalStringList(input.patch, "List");
}

function resolveBooleanDraft(input: {
  patch: string | undefined;
  current: boolean;
  label: string;
}): boolean {
  if (input.patch === undefined) {
    return input.current;
  }

  try {
    return normalizeBooleanChoice(input.patch, input.label);
  } catch {
    return input.current;
  }
}

function captureValidationError(
  validate: () => void,
  onError: (message: string) => void,
): void {
  try {
    validate();
  } catch (error) {
    onError(error instanceof Error ? error.message : "Validation failed");
  }
}
