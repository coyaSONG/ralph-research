import {
  type ResearchSessionDraft,
  type ResearchSessionDraftStep,
  type ResearchSessionDraftUpdate,
  type ResearchSessionDraftValidationResult,
  validateOutputsStepDraft,
  validatePermissionsStepDraft,
  validateReviewStepDraft,
  validateStopRulesStepDraft,
} from "./research-session-draft-service.js";

export interface ResearchSessionWizardStepDefinition {
  step: ResearchSessionDraftStep;
  index: number;
  total: number;
  label: string;
  title: string;
  advanceCommand: "continue" | "submit";
  helpText: string;
  blockedMessage: string;
  advanceMessage: string;
}

export interface ResearchSessionWizardSectionStatus {
  step: ResearchSessionDraftStep;
  index: number;
  total: number;
  label: string;
  title: string;
  isCurrent: boolean;
  isCompleted: boolean;
  validation: ResearchSessionDraftValidationResult;
}

export interface ResearchSessionWizardBackResult {
  transition: "blocked" | "step_changed";
  message: string;
  patch?: ResearchSessionDraftUpdate;
}

export interface ResearchSessionWizardNextResult {
  transition: "blocked" | "step_changed";
  message: string;
  patch?: ResearchSessionDraftUpdate;
}

export interface ResearchSessionWizardReviewEditResult {
  transition: "step_changed";
  message: string;
  patch: ResearchSessionDraftUpdate;
}

export interface ResearchSessionWizardAdvanceResult {
  transition: "blocked" | "step_changed" | "ready_to_launch";
  validation: ResearchSessionDraftValidationResult;
  message: string;
  patch?: ResearchSessionDraftUpdate;
}

const STEP_ORDER: readonly ResearchSessionDraftStep[] = [
  "permissions",
  "stopRules",
  "outputs",
  "review",
];

const STEP_DEFINITIONS: Record<ResearchSessionDraftStep, ResearchSessionWizardStepDefinition> = {
  permissions: {
    step: "permissions",
    index: 0,
    total: STEP_ORDER.length,
    label: "Permissions",
    title: "Step 1/4: Permissions",
    advanceCommand: "continue",
    helpText:
      "Commands: edit <1-6|working|directory|cwd|web|search|add|allow|remove|deny|block|approval|sandbox>, next, continue, back, help, quit",
    blockedMessage: "Permissions step has validation errors. Fix them before continuing.",
    advanceMessage: "Permissions step saved. Opening Stop Rules.",
  },
  stopRules: {
    step: "stopRules",
    index: 1,
    total: STEP_ORDER.length,
    label: "Stop Rules",
    title: "Step 2/4: Stop Rules",
    advanceCommand: "continue",
    helpText: "Commands: edit <1-3|failures|progress|evidence>, next, continue, back, help, quit",
    blockedMessage: "Stop Rules step has validation errors. Fix them before continuing.",
    advanceMessage: "Stop Rules step saved. Opening Outputs.",
  },
  outputs: {
    step: "outputs",
    index: 2,
    total: STEP_ORDER.length,
    label: "Outputs",
    title: "Step 3/4: Outputs",
    advanceCommand: "continue",
    helpText:
      "Commands: edit <1-7|goal|trackable|files|globs|baseline|base|agent|command|model|startup|turn>, next, continue, back, help, quit",
    blockedMessage: "Outputs step has validation errors. Fix them before continuing.",
    advanceMessage: "Outputs step saved. Opening Review.",
  },
  review: {
    step: "review",
    index: 3,
    total: STEP_ORDER.length,
    label: "Review",
    title: "Step 4/4: Review",
    advanceCommand: "submit",
    helpText: "Commands: confirm, submit, help, quit",
    blockedMessage: "Review has validation errors. Fix the highlighted section before submitting.",
    advanceMessage: "Review complete. Starting the interactive Codex session.",
  },
};

export function getResearchSessionWizardStepDefinition(
  step: ResearchSessionDraftStep,
): ResearchSessionWizardStepDefinition {
  return STEP_DEFINITIONS[step];
}

export function validateResearchSessionWizardStep(
  draft: ResearchSessionDraft,
): ResearchSessionDraftValidationResult {
  return validateResearchSessionWizardSpecificStep(draft, draft.currentStep);
}

export function getResearchSessionWizardSectionStatuses(
  draft: ResearchSessionDraft,
): ResearchSessionWizardSectionStatus[] {
  const completedSteps = new Set(draft.completedSteps);

  return STEP_ORDER.map((step) => {
    const definition = STEP_DEFINITIONS[step];

    return {
      step,
      index: definition.index,
      total: definition.total,
      label: definition.label,
      title: definition.title,
      isCurrent: draft.currentStep === step,
      isCompleted: completedSteps.has(step),
      validation: validateResearchSessionWizardSpecificStep(draft, step),
    };
  });
}

function validateResearchSessionWizardSpecificStep(
  draft: ResearchSessionDraft,
  step: ResearchSessionDraftStep,
): ResearchSessionDraftValidationResult {
  switch (step) {
    case "permissions":
      return validatePermissionsStepDraft(draft);
    case "stopRules":
      return validateStopRulesStepDraft(draft);
    case "outputs":
      return validateOutputsStepDraft(draft);
    case "review":
      return validateReviewStepDraft(draft);
  }
}

export function isResearchSessionWizardAdvanceCommand(
  command: string,
  step: ResearchSessionDraftStep,
): boolean {
  const normalized = command.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized === STEP_DEFINITIONS[step].advanceCommand;
}

export function getResearchSessionWizardBackResult(
  step: ResearchSessionDraftStep,
): ResearchSessionWizardBackResult {
  const previousStep = getResearchSessionWizardPreviousStep(step);
  if (!previousStep) {
    return {
      transition: "blocked",
      message: `Already at the first step: ${STEP_DEFINITIONS[step].label}.`,
    };
  }

  return {
    transition: "step_changed",
    message: `Returning to ${STEP_DEFINITIONS[previousStep].title}.`,
    patch: {
      currentStep: previousStep,
    },
  };
}

export function getResearchSessionWizardNextResult(
  step: ResearchSessionDraftStep,
): ResearchSessionWizardNextResult {
  const nextStep = getResearchSessionWizardNextStep(step);
  if (!nextStep) {
    return {
      transition: "blocked",
      message: `Already at the last step: ${STEP_DEFINITIONS[step].label}.`,
    };
  }

  return {
    transition: "step_changed",
    message: `Opening ${STEP_DEFINITIONS[nextStep].title}.`,
    patch: {
      currentStep: nextStep,
    },
  };
}

export function getResearchSessionWizardAdvanceResult(
  draft: ResearchSessionDraft,
): ResearchSessionWizardAdvanceResult {
  const validation = validateResearchSessionWizardStep(draft);
  const definition = STEP_DEFINITIONS[draft.currentStep];
  const completedSteps = markResearchSessionWizardStepCompleted(draft.completedSteps, draft.currentStep);
  const stepDataPatch = buildResearchSessionWizardAdvancePatch(draft);
  const advanceMessage =
    draft.returnToReview && draft.currentStep !== "review"
      ? `${definition.label} step saved. Returning to Review.`
      : definition.advanceMessage;
  if (!validation.isValid) {
    return {
      transition: "blocked",
      validation,
      message: definition.blockedMessage,
    };
  }

  if (draft.currentStep === "review" && !draft.reviewConfirmed) {
    return {
      transition: "blocked",
      validation,
      message: "Review requires final confirmation before submitting.",
    };
  }

  const nextStep = getResearchSessionWizardNextStep(draft.currentStep);
  const nextStepAfterAdvance =
    draft.returnToReview && draft.currentStep !== "review" ? "review" : nextStep;
  if (!nextStepAfterAdvance) {
    return {
      transition: "ready_to_launch",
      validation,
      message: advanceMessage,
      patch: {
        ...stepDataPatch,
        completedSteps,
        returnToReview: false,
      },
    };
  }

  return {
    transition: "step_changed",
    validation,
    message: advanceMessage,
    patch: {
      ...stepDataPatch,
      currentStep: nextStepAfterAdvance,
      completedSteps,
      returnToReview: false,
    },
  };
}

export function getResearchSessionWizardReviewEditResult(
  targetStep: Exclude<ResearchSessionDraftStep, "review">,
): ResearchSessionWizardReviewEditResult {
  return {
    transition: "step_changed",
    message: `Review jump: reopening ${STEP_DEFINITIONS[targetStep].title}. Return here with continue when you are done editing.`,
    patch: {
      currentStep: targetStep,
      returnToReview: true,
    },
  };
}

function getResearchSessionWizardPreviousStep(
  step: ResearchSessionDraftStep,
): ResearchSessionDraftStep | null {
  const stepIndex = STEP_ORDER.indexOf(step);
  return stepIndex > 0 ? STEP_ORDER[stepIndex - 1] ?? null : null;
}

function getResearchSessionWizardNextStep(
  step: ResearchSessionDraftStep,
): ResearchSessionDraftStep | null {
  const stepIndex = STEP_ORDER.indexOf(step);
  return stepIndex >= 0 && stepIndex < STEP_ORDER.length - 1
    ? STEP_ORDER[stepIndex + 1] ?? null
    : null;
}

function buildResearchSessionWizardAdvancePatch(
  draft: ResearchSessionDraft,
): ResearchSessionDraftUpdate {
  if (draft.currentStep !== "outputs") {
    return {};
  }

  return {
    goal: draft.goal,
    contextSettings: {
      trackableGlobs: draft.contextSettings.trackableGlobs,
    },
    workspaceSettings: {
      baseRef: draft.workspaceSettings.baseRef,
    },
    agentCommand: draft.agentCommand,
    agentSettings: {
      model: draft.agentSettings.model,
      startupTimeoutSec: draft.agentSettings.startupTimeoutSec,
      turnTimeoutSec: draft.agentSettings.turnTimeoutSec,
    },
  };
}

function markResearchSessionWizardStepCompleted(
  completedSteps: readonly ResearchSessionDraftStep[],
  step: ResearchSessionDraftStep,
): ResearchSessionDraftStep[] {
  const nextCompletedSteps = new Set(completedSteps);
  nextCompletedSteps.add(step);

  return STEP_ORDER.filter((candidateStep) => nextCompletedSteps.has(candidateStep));
}
