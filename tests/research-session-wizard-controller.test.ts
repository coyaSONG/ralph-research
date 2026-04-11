import { describe, expect, it } from "vitest";

import {
  buildResearchSessionReviewState,
  type ResearchSessionDraft,
} from "../src/app/services/research-session-draft-service.js";
import {
  getResearchSessionWizardAdvanceResult,
  getResearchSessionWizardBackResult,
  getResearchSessionWizardNextResult,
  getResearchSessionWizardReviewEditResult,
  getResearchSessionWizardSectionStatuses,
  getResearchSessionWizardStepDefinition,
  isResearchSessionWizardAdvanceCommand,
} from "../src/app/services/research-session-wizard-controller.js";

describe("research-session-wizard-controller", () => {
  it("uses the shared permissions -> stop rules -> outputs -> review step ordering", () => {
    expect(getResearchSessionWizardStepDefinition("permissions")).toMatchObject({
      index: 0,
      total: 4,
      title: "Step 1/4: Permissions",
      advanceCommand: "continue",
    });
    expect(getResearchSessionWizardStepDefinition("stopRules")).toMatchObject({
      index: 1,
      title: "Step 2/4: Stop Rules",
      advanceCommand: "continue",
    });
    expect(getResearchSessionWizardStepDefinition("outputs")).toMatchObject({
      index: 2,
      title: "Step 3/4: Outputs",
      advanceCommand: "continue",
    });
    expect(getResearchSessionWizardStepDefinition("review")).toMatchObject({
      index: 3,
      title: "Step 4/4: Review",
      advanceCommand: "submit",
      helpText: "Commands: confirm, submit, help, quit",
    });
  });

  it("blocks going back before the first step and only changes currentStep on valid back navigation", () => {
    expect(getResearchSessionWizardBackResult("permissions")).toEqual({
      transition: "blocked",
      message: "Already at the first step: Permissions.",
    });
    expect(getResearchSessionWizardBackResult("outputs")).toEqual({
      transition: "step_changed",
      message: "Returning to Step 2/4: Stop Rules.",
      patch: {
        currentStep: "stopRules",
      },
    });
  });

  it("blocks going next after the final step and only changes currentStep on valid next navigation", () => {
    expect(getResearchSessionWizardNextResult("review")).toEqual({
      transition: "blocked",
      message: "Already at the last step: Review.",
    });
    expect(getResearchSessionWizardNextResult("permissions")).toEqual({
      transition: "step_changed",
      message: "Opening Step 2/4: Stop Rules.",
      patch: {
        currentStep: "stopRules",
      },
    });
  });

  it("blocks permissions navigation until the current step is valid", () => {
    const result = getResearchSessionWizardAdvanceResult(
      makeDraft({
        currentStep: "permissions",
        workingDirectory: "../",
        contextSettings: {
          webSearch: "sometimes",
        },
        agentSettings: {
          approvalPolicy: "sometimes",
          sandboxMode: "unsafe",
        },
      }),
    );

    expect(result.transition).toBe("blocked");
    expect(result.message).toBe("Permissions step has validation errors. Fix them before continuing.");
    expect(result.patch).toBeUndefined();
    expect(result.validation.fieldErrors).toMatchObject({
      workingDirectory: "Working directory must stay within the repo root",
      webSearch: "Web search must be enabled or disabled",
      approvalPolicy: "Approval policy must be one of: never, on-failure, on-request, untrusted",
      sandboxMode: "Sandbox mode must be one of: read-only, workspace-write, danger-full-access",
    });
  });

  it("treats missing permissions inputs as inline validation failures before advancing", () => {
    const result = getResearchSessionWizardAdvanceResult(
      makeDraft({
        currentStep: "permissions",
        workingDirectory: "   ",
        contextSettings: {
          webSearch: "   ",
        },
        agentSettings: {
          approvalPolicy: "   ",
          sandboxMode: "   ",
        },
      }),
    );

    expect(result.transition).toBe("blocked");
    expect(result.message).toBe("Permissions step has validation errors. Fix them before continuing.");
    expect(result.patch).toBeUndefined();
    expect(result.validation.fieldErrors).toMatchObject({
      workingDirectory: "Working directory is required",
      webSearch: "Web search must be enabled or disabled",
      approvalPolicy: "Approval policy must be one of: never, on-failure, on-request, untrusted",
      sandboxMode: "Sandbox mode must be one of: read-only, workspace-write, danger-full-access",
    });
  });

  it("blocks stop-rules navigation until the thresholds are valid", () => {
    const result = getResearchSessionWizardAdvanceResult(
      makeDraft({
        currentStep: "stopRules",
        stopPolicy: {
          repeatedFailures: "0",
          noMeaningfulProgress: "0",
          insufficientEvidence: "0",
        },
      }),
    );

    expect(result.transition).toBe("blocked");
    expect(result.message).toBe("Stop Rules step has validation errors. Fix them before continuing.");
    expect(result.patch).toBeUndefined();
    expect(result.validation.fieldErrors).toMatchObject({
      repeatedFailures: "Repeated failures threshold must be a positive integer",
      noMeaningfulProgress: "No-progress threshold must be a positive integer",
      insufficientEvidence: "Insufficient-evidence threshold must be a positive integer",
    });
  });

  it("treats missing stop-rule inputs as inline validation failures before advancing", () => {
    const result = getResearchSessionWizardAdvanceResult(
      makeDraft({
        currentStep: "stopRules",
        stopPolicy: {
          repeatedFailures: "   ",
          noMeaningfulProgress: "   ",
          insufficientEvidence: "   ",
        },
      }),
    );

    expect(result.transition).toBe("blocked");
    expect(result.message).toBe("Stop Rules step has validation errors. Fix them before continuing.");
    expect(result.patch).toBeUndefined();
    expect(result.validation.fieldErrors).toMatchObject({
      repeatedFailures: "Repeated failures threshold must be a positive integer",
      noMeaningfulProgress: "No-progress threshold must be a positive integer",
      insufficientEvidence: "Insufficient-evidence threshold must be a positive integer",
    });
  });

  it("blocks outputs navigation until the output targets stay inside the working directory and required fields are complete", () => {
    const result = getResearchSessionWizardAdvanceResult(
      makeDraft({
        currentStep: "outputs",
        completedSteps: ["permissions", "stopRules"],
        goal: "   ",
        contextSettings: {
          trackableGlobs: "../reports/**/*.json",
        },
        workspaceSettings: {
          baseRef: "   ",
        },
        agentCommand: "   ",
        agentSettings: {
          startupTimeoutSec: "0",
          turnTimeoutSec: "-1",
        },
      }),
    );

    expect(result.transition).toBe("blocked");
    expect(result.message).toBe("Outputs step has validation errors. Fix them before continuing.");
    expect(result.patch).toBeUndefined();
    expect(result.validation.fieldErrors).toMatchObject({
      goal: "Goal is required",
      trackableGlobs: "Trackable files must stay within the working directory",
      baseRef: "Baseline ref is required",
      agentCommand: "Agent command is required",
      startupTimeoutSec: "Agent startup timeout must be a positive integer",
      turnTimeoutSec: "Agent turn timeout must be a positive integer",
    });
  });

  it("advances one step at a time without mutating saved section inputs", () => {
    expect(
      getResearchSessionWizardAdvanceResult(
        makeDraft({
          currentStep: "permissions",
        }),
      ),
    ).toEqual({
      transition: "step_changed",
      validation: {
        isValid: true,
        fieldErrors: {},
      },
      message: "Permissions step saved. Opening Stop Rules.",
      patch: {
        currentStep: "stopRules",
        completedSteps: ["permissions"],
        returnToReview: false,
      },
    });

    expect(
      getResearchSessionWizardAdvanceResult(
        makeDraft({
          currentStep: "stopRules",
          completedSteps: ["permissions"],
        }),
      ),
    ).toEqual({
      transition: "step_changed",
      validation: {
        isValid: true,
        fieldErrors: {},
      },
      message: "Stop Rules step saved. Opening Outputs.",
      patch: {
        currentStep: "outputs",
        completedSteps: ["permissions", "stopRules"],
        returnToReview: false,
      },
    });

    expect(
      getResearchSessionWizardAdvanceResult(
        makeDraft({
          currentStep: "outputs",
          completedSteps: ["permissions", "stopRules"],
        }),
      ),
    ).toEqual({
      transition: "step_changed",
      validation: {
        isValid: true,
        fieldErrors: {},
      },
      message: "Outputs step saved. Opening Review.",
      patch: {
        goal: "improve the holdout top-3 model",
        contextSettings: {
          trackableGlobs: "**/*.ts, **/*.md",
        },
        workspaceSettings: {
          baseRef: "HEAD",
        },
        agentCommand: "codex",
        agentSettings: {
          model: "",
          startupTimeoutSec: "30",
          turnTimeoutSec: "900",
        },
        currentStep: "review",
        completedSteps: ["permissions", "stopRules", "outputs"],
        returnToReview: false,
      },
    });
  });

  it("switches from continue to submit on the final step and guards launch behind outputs validation", () => {
    expect(isResearchSessionWizardAdvanceCommand("continue", "permissions")).toBe(true);
    expect(isResearchSessionWizardAdvanceCommand("submit", "permissions")).toBe(false);
    expect(isResearchSessionWizardAdvanceCommand("continue", "outputs")).toBe(true);
    expect(isResearchSessionWizardAdvanceCommand("submit", "outputs")).toBe(false);
    expect(isResearchSessionWizardAdvanceCommand("submit", "review")).toBe(true);
    expect(isResearchSessionWizardAdvanceCommand("continue", "review")).toBe(false);

    const blockedOutputs = getResearchSessionWizardAdvanceResult(
      makeDraft({
        currentStep: "outputs",
        completedSteps: ["permissions", "stopRules"],
        goal: "   ",
        agentCommand: "   ",
        contextSettings: {
          trackableGlobs: "   ",
        },
        workspaceSettings: {
          baseRef: "   ",
        },
        agentSettings: {
          startupTimeoutSec: "0",
          turnTimeoutSec: "-1",
        },
      }),
    );
    expect(blockedOutputs.transition).toBe("blocked");
    expect(blockedOutputs.message).toBe("Outputs step has validation errors. Fix them before continuing.");

    const readyForReview = getResearchSessionWizardAdvanceResult(
      makeDraft({
        currentStep: "outputs",
        completedSteps: ["permissions", "stopRules"],
        agentCommand: "codex --model gpt-5.4",
        contextSettings: {
          trackableGlobs: "**/*.ts, **/*.md",
        },
        workspaceSettings: {
          baseRef: "HEAD",
        },
        agentSettings: {
          startupTimeoutSec: "45",
          turnTimeoutSec: "1200",
        },
      }),
    );
    expect(readyForReview).toEqual({
      transition: "step_changed",
      validation: {
        isValid: true,
        fieldErrors: {},
      },
      message: "Outputs step saved. Opening Review.",
      patch: {
        goal: "improve the holdout top-3 model",
        contextSettings: {
          trackableGlobs: "**/*.ts, **/*.md",
        },
        workspaceSettings: {
          baseRef: "HEAD",
        },
        agentCommand: "codex --model gpt-5.4",
        agentSettings: {
          model: "",
          startupTimeoutSec: "45",
          turnTimeoutSec: "1200",
        },
        currentStep: "review",
        completedSteps: ["permissions", "stopRules", "outputs"],
        returnToReview: false,
      },
    });

    const blockedUntilConfirmed = getResearchSessionWizardAdvanceResult(
      makeDraft({
        currentStep: "review",
        completedSteps: ["permissions", "stopRules", "outputs"],
        agentCommand: "codex --model gpt-5.4",
        contextSettings: {
          trackableGlobs: "**/*.ts, **/*.md",
        },
        workspaceSettings: {
          baseRef: "HEAD",
        },
        agentSettings: {
          startupTimeoutSec: "45",
          turnTimeoutSec: "1200",
        },
      }),
    );
    expect(blockedUntilConfirmed).toEqual({
      transition: "blocked",
      validation: {
        isValid: true,
        fieldErrors: {},
      },
      message: "Review requires final confirmation before submitting.",
    });

    const readyToLaunch = getResearchSessionWizardAdvanceResult(
      makeDraft({
        currentStep: "review",
        completedSteps: ["permissions", "stopRules", "outputs"],
        reviewConfirmed: true,
        agentCommand: "codex --model gpt-5.4",
        contextSettings: {
          trackableGlobs: "**/*.ts, **/*.md",
        },
        workspaceSettings: {
          baseRef: "HEAD",
        },
        agentSettings: {
          startupTimeoutSec: "45",
          turnTimeoutSec: "1200",
        },
      }),
    );
    expect(readyToLaunch).toEqual({
      transition: "ready_to_launch",
      validation: {
        isValid: true,
        fieldErrors: {},
      },
      message: "Review complete. Starting the interactive Codex session.",
      patch: {
        completedSteps: ["permissions", "stopRules", "outputs", "review"],
        returnToReview: false,
      },
    });
  });

  it("lets review jump back into a section and mark the next continue as a return to review", () => {
    expect(getResearchSessionWizardReviewEditResult("stopRules")).toEqual({
      transition: "step_changed",
      message: "Review jump: reopening Step 2/4: Stop Rules. Return here with continue when you are done editing.",
      patch: {
        currentStep: "stopRules",
        returnToReview: true,
      },
    });

    expect(
      getResearchSessionWizardAdvanceResult(
        makeDraft({
          currentStep: "stopRules",
          completedSteps: ["permissions", "stopRules", "outputs"],
          returnToReview: true,
        }),
      ),
    ).toEqual({
      transition: "step_changed",
      validation: {
        isValid: true,
        fieldErrors: {},
      },
      message: "Stop Rules step saved. Returning to Review.",
      patch: {
        currentStep: "review",
        completedSteps: ["permissions", "stopRules", "outputs"],
        returnToReview: false,
      },
    });
  });

  it("includes the validated outputs payload when returning from outputs back to review", () => {
    expect(
      getResearchSessionWizardAdvanceResult(
        makeDraft({
          currentStep: "outputs",
          completedSteps: ["permissions", "stopRules", "outputs"],
          returnToReview: true,
          goal: "beat 70 percent future holdout top-3 accuracy",
          contextSettings: {
            trackableGlobs: "**/*.ts, reports/**/*.json",
          },
          workspaceSettings: {
            baseRef: "HEAD~1",
          },
          agentCommand: "codex --model gpt-5.4 --full-auto",
          agentSettings: {
            model: "gpt-5.4",
            startupTimeoutSec: "45",
            turnTimeoutSec: "1200",
          },
        }),
      ),
    ).toEqual({
      transition: "step_changed",
      validation: {
        isValid: true,
        fieldErrors: {},
      },
      message: "Outputs step saved. Returning to Review.",
      patch: {
        goal: "beat 70 percent future holdout top-3 accuracy",
        contextSettings: {
          trackableGlobs: "**/*.ts, reports/**/*.json",
        },
        workspaceSettings: {
          baseRef: "HEAD~1",
        },
        agentCommand: "codex --model gpt-5.4 --full-auto",
        agentSettings: {
          model: "gpt-5.4",
          startupTimeoutSec: "45",
          turnTimeoutSec: "1200",
        },
        currentStep: "review",
        completedSteps: ["permissions", "stopRules", "outputs"],
        returnToReview: false,
      },
    });
  });

  it("tracks section completion separately from validation for the shared progress component", () => {
    const statuses = getResearchSessionWizardSectionStatuses(
      makeDraft({
        currentStep: "stopRules",
        completedSteps: ["permissions", "stopRules"],
        workingDirectory: "../",
        contextSettings: {
          webSearch: "sometimes",
        },
        agentSettings: {
          approvalPolicy: "sometimes",
          sandboxMode: "unsafe",
        },
      }),
    );

    expect(statuses).toEqual([
      expect.objectContaining({
        step: "permissions",
        label: "Permissions",
        isCurrent: false,
        isCompleted: true,
      }),
      expect.objectContaining({
        step: "stopRules",
        label: "Stop Rules",
        isCurrent: true,
        isCompleted: true,
        validation: {
          isValid: true,
          fieldErrors: {},
        },
      }),
      expect.objectContaining({
        step: "outputs",
        label: "Outputs",
        isCurrent: false,
        isCompleted: false,
        validation: {
          isValid: true,
          fieldErrors: {},
        },
      }),
      expect.objectContaining({
        step: "review",
        label: "Review",
        isCurrent: false,
        isCompleted: false,
        validation: expect.objectContaining({
          isValid: false,
        }),
      }),
    ]);
  });
});

function makeDraft(overrides: Partial<ResearchSessionDraft>): ResearchSessionDraft {
  const repoRoot = process.cwd();

  const draft: ResearchSessionDraft = {
    sessionId: "launch-draft",
    currentStep: "permissions",
    completedSteps: [],
    returnToReview: false,
    reviewConfirmed: false,
    goal: "improve the holdout top-3 model",
    repoRoot,
    workingDirectory: repoRoot,
    contextSettings: {
      trackableGlobs: "**/*.ts, **/*.md",
      webSearch: "enabled",
      shellCommandAllowlistAdditions: "",
      shellCommandAllowlistRemovals: "",
    },
    workspaceSettings: {
      baseRef: "HEAD",
    },
    agentCommand: "codex",
    stopPolicy: {
      repeatedFailures: "3",
      noMeaningfulProgress: "5",
      insufficientEvidence: "3",
    },
    agentSettings: {
      model: "",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      startupTimeoutSec: "30",
      turnTimeoutSec: "900",
    },
  };

  const merged = {
    ...draft,
    ...overrides,
    completedSteps: overrides.completedSteps ?? draft.completedSteps,
    returnToReview: overrides.returnToReview ?? draft.returnToReview,
    reviewConfirmed: overrides.reviewConfirmed ?? draft.reviewConfirmed,
    contextSettings: {
      ...draft.contextSettings,
      ...overrides.contextSettings,
    },
    workspaceSettings: {
      ...draft.workspaceSettings,
      ...overrides.workspaceSettings,
    },
    stopPolicy: {
      ...draft.stopPolicy,
      ...overrides.stopPolicy,
    },
    agentSettings: {
      ...draft.agentSettings,
      ...overrides.agentSettings,
    },
  };

  return {
    ...merged,
    reviewState: buildResearchSessionReviewState(merged),
  };
}
