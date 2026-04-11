import { createInterface } from "node:readline/promises";

import {
  buildResearchSessionReviewSummary,
  ResearchSessionDraftService,
  type ResearchSessionDraft,
  type ResearchSessionDraftStep,
  type ResearchSessionDraftValidationResult,
  type ResearchSessionReviewSummarySection,
} from "../../app/services/research-session-draft-service.js";
import { ResearchSessionInteractiveService } from "../../app/services/research-session-interactive-service.js";
import {
  getResearchSessionWizardAdvanceResult,
  getResearchSessionWizardBackResult,
  getResearchSessionWizardNextResult,
  getResearchSessionWizardSectionStatuses,
  getResearchSessionWizardStepDefinition,
  isResearchSessionWizardAdvanceCommand,
  validateResearchSessionWizardStep,
  type ResearchSessionWizardSectionStatus,
} from "../../app/services/research-session-wizard-controller.js";
import type {
  ExistingResearchSessionInspection,
  ResearchSessionLaunchResult,
} from "../../app/services/research-session-launch-service.js";
import type { CommandIO } from "../commands/run.js";

export interface ResearchSessionShellDependencies {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  draftService?: Pick<ResearchSessionDraftService, "loadDraft" | "updateDraft">;
  interactiveSessionService?: Pick<ResearchSessionInteractiveService, "launchFromDraft">;
  createReadline?: (input: NodeJS.ReadableStream, output: NodeJS.WritableStream) => QuestioningInterface;
}

export interface ResearchSessionShellEntrySelection {
  entrySelection: "resume";
  sessionId: string;
}

export type ResearchSessionShell = (
  session: ResearchSessionLaunchResult,
  io: CommandIO,
  dependencies?: ResearchSessionShellDependencies,
) => Promise<ResearchSessionShellEntrySelection | void>;

type SelectedCandidateSummary = NonNullable<ResearchSessionLaunchResult["selectedCandidateSummary"]>;

interface QuestioningInterface {
  question(prompt: string): Promise<string>;
  close(): void;
}

interface EditableField {
  id: string;
  label: string;
  aliases: string[];
  prompt: string;
  validationField?: keyof ResearchSessionDraftValidationResult["fieldErrors"];
  getValue: (draft: ResearchSessionDraft) => string;
  createPatch: (value: string) => Parameters<ResearchSessionDraftService["updateDraft"]>[0]["patch"];
}

const EXIT_COMMANDS = new Set(["quit", "exit", ":q"]);
const HELP_COMMANDS = new Set(["help", "?"]);
const CONFIRM_COMMANDS = new Set(["confirm"]);
const RESUME_COMMANDS = new Set(["resume", "continue"]);
const NEXT_COMMANDS = new Set(["next"]);
const INSPECT_COMMANDS = new Set(["inspect", "show", "status"]);
const NEW_COMMANDS = new Set(["new", "new session", "new-session", "fresh", "start"]);

const PERMISSIONS_FIELDS: readonly EditableField[] = [
  {
    id: "1",
    label: "Working directory",
    aliases: ["working", "directory", "cwd"],
    prompt: "Working directory: ",
    validationField: "workingDirectory",
    getValue: (draft) => draft.workingDirectory,
    createPatch: (value) => ({
      workingDirectory: value,
    }),
  },
  {
    id: "2",
    label: "Web search",
    aliases: ["web", "search"],
    prompt: "Web search (enabled|disabled): ",
    validationField: "webSearch",
    getValue: (draft) => draft.contextSettings.webSearch,
    createPatch: (value) => ({
      contextSettings: {
        webSearch: value,
      },
    }),
  },
  {
    id: "3",
    label: "Shell allowlist additions",
    aliases: ["add", "allow"],
    prompt: "Shell allowlist additions: ",
    validationField: "shellCommandAllowlistAdditions",
    getValue: (draft) => draft.contextSettings.shellCommandAllowlistAdditions,
    createPatch: (value) => ({
      contextSettings: {
        shellCommandAllowlistAdditions: value,
      },
    }),
  },
  {
    id: "4",
    label: "Shell allowlist removals",
    aliases: ["remove", "deny", "block"],
    prompt: "Shell allowlist removals: ",
    validationField: "shellCommandAllowlistRemovals",
    getValue: (draft) => draft.contextSettings.shellCommandAllowlistRemovals,
    createPatch: (value) => ({
      contextSettings: {
        shellCommandAllowlistRemovals: value,
      },
    }),
  },
  {
    id: "5",
    label: "Approval policy",
    aliases: ["approval"],
    prompt: "Approval policy: ",
    validationField: "approvalPolicy",
    getValue: (draft) => draft.agentSettings.approvalPolicy,
    createPatch: (value) => ({
      agentSettings: {
        approvalPolicy: value,
      },
    }),
  },
  {
    id: "6",
    label: "Sandbox mode",
    aliases: ["sandbox"],
    prompt: "Sandbox mode: ",
    validationField: "sandboxMode",
    getValue: (draft) => draft.agentSettings.sandboxMode,
    createPatch: (value) => ({
      agentSettings: {
        sandboxMode: value,
      },
    }),
  },
];

const STOP_RULE_FIELDS: readonly EditableField[] = [
  {
    id: "1",
    label: "Repeated failures threshold",
    aliases: ["failures"],
    prompt: "Repeated failures threshold: ",
    validationField: "repeatedFailures",
    getValue: (draft) => draft.stopPolicy.repeatedFailures,
    createPatch: (value) => ({
      stopPolicy: {
        repeatedFailures: value,
      },
    }),
  },
  {
    id: "2",
    label: "No-progress threshold",
    aliases: ["progress"],
    prompt: "No-progress threshold: ",
    validationField: "noMeaningfulProgress",
    getValue: (draft) => draft.stopPolicy.noMeaningfulProgress,
    createPatch: (value) => ({
      stopPolicy: {
        noMeaningfulProgress: value,
      },
    }),
  },
  {
    id: "3",
    label: "Insufficient-evidence threshold",
    aliases: ["evidence"],
    prompt: "Insufficient-evidence threshold: ",
    validationField: "insufficientEvidence",
    getValue: (draft) => draft.stopPolicy.insufficientEvidence,
    createPatch: (value) => ({
      stopPolicy: {
        insufficientEvidence: value,
      },
    }),
  },
];

const OUTPUT_FIELDS: readonly EditableField[] = [
  {
    id: "1",
    label: "Goal",
    aliases: ["goal"],
    prompt: "Goal: ",
    validationField: "goal",
    getValue: (draft) => draft.goal,
    createPatch: (value) => ({
      goal: value,
    }),
  },
  {
    id: "2",
    label: "Trackable files",
    aliases: ["trackable", "files", "globs"],
    prompt: "Trackable files: ",
    validationField: "trackableGlobs",
    getValue: (draft) => draft.contextSettings.trackableGlobs,
    createPatch: (value) => ({
      contextSettings: {
        trackableGlobs: value,
      },
    }),
  },
  {
    id: "3",
    label: "Baseline ref",
    aliases: ["baseline", "base"],
    prompt: "Baseline ref: ",
    validationField: "baseRef",
    getValue: (draft) => draft.workspaceSettings.baseRef,
    createPatch: (value) => ({
      workspaceSettings: {
        baseRef: value,
      },
    }),
  },
  {
    id: "4",
    label: "Agent command",
    aliases: ["agent", "command"],
    prompt: "Agent command: ",
    validationField: "agentCommand",
    getValue: (draft) => draft.agentCommand,
    createPatch: (value) => ({
      agentCommand: value,
    }),
  },
  {
    id: "5",
    label: "Model override",
    aliases: ["model"],
    prompt: "Model override: ",
    getValue: (draft) => draft.agentSettings.model,
    createPatch: (value) => ({
      agentSettings: {
        model: value,
      },
    }),
  },
  {
    id: "6",
    label: "Startup timeout (sec)",
    aliases: ["startup"],
    prompt: "Startup timeout (sec): ",
    validationField: "startupTimeoutSec",
    getValue: (draft) => draft.agentSettings.startupTimeoutSec,
    createPatch: (value) => ({
      agentSettings: {
        startupTimeoutSec: value,
      },
    }),
  },
  {
    id: "7",
    label: "Turn timeout (sec)",
    aliases: ["turn"],
    prompt: "Turn timeout (sec): ",
    validationField: "turnTimeoutSec",
    getValue: (draft) => draft.agentSettings.turnTimeoutSec,
    createPatch: (value) => ({
      agentSettings: {
        turnTimeoutSec: value,
      },
    }),
  },
];

const STEP_FIELDS: Record<ResearchSessionDraftStep, readonly EditableField[]> = {
  permissions: PERMISSIONS_FIELDS,
  stopRules: STOP_RULE_FIELDS,
  outputs: OUTPUT_FIELDS,
  review: [],
};

const STEP_FIELD_LOOKUP: Record<ResearchSessionDraftStep, Map<string, EditableField>> = {
  permissions: createFieldLookup(PERMISSIONS_FIELDS),
  stopRules: createFieldLookup(STOP_RULE_FIELDS),
  outputs: createFieldLookup(OUTPUT_FIELDS),
  review: new Map(),
};

export const openResearchSessionShell: ResearchSessionShell = async (
  session,
  io,
  dependencies = {},
) => {
  const input = dependencies.input ?? process.stdin;
  const output = dependencies.output ?? process.stdout;
  const draftService = dependencies.draftService ?? new ResearchSessionDraftService();
  const interactiveSessionService =
    dependencies.interactiveSessionService ?? new ResearchSessionInteractiveService();
  const createQuestionInterface =
    dependencies.createReadline ??
    ((interfaceInput, interfaceOutput) =>
      createInterface({
        input: interfaceInput,
        output: interfaceOutput,
        terminal: true,
      }));

  let draft = await draftService.loadDraft({
    repoRoot: session.repoRoot,
    sessionId: session.sessionId,
  });

  renderSessionSummary(session, draft, io);

  if (!isInteractiveTerminal(input, output)) {
    if (session.existingSession) {
      renderExistingSessionSummary(
        {
          existingSession: session.existingSession,
          ...(session.selectedCandidateSummary
            ? { selectedCandidateSummary: session.selectedCandidateSummary }
            : {}),
        },
        io,
      );
    }
    const validation = validateCurrentStep(draft);
    renderCurrentStep(draft, validation, io);
    io.stdout("Interactive terminal not detected. Session draft saved without starting a research cycle.");
    return;
  }

  const readline = createQuestionInterface(input, output);

  try {
    if (session.existingSession) {
      const action = await promptExistingSessionAction({
        existingSession: session.existingSession,
        ...(session.selectedCandidateSummary
          ? { selectedCandidateSummary: session.selectedCandidateSummary }
          : {}),
        repoRoot: session.repoRoot,
        io,
        readline,
      });
      if (action === "quit") {
        return;
      }
      if (action !== "new") {
        return action;
      }
    }

    let validation = validateCurrentStep(draft);
    renderCurrentStep(draft, validation, io);
    renderCommandHelp(io, draft.currentStep);

    while (true) {
      const command = (await readline.question(`${draft.currentStep}> `)).trim().toLowerCase();

      if (!command || HELP_COMMANDS.has(command)) {
        validation = validateCurrentStep(draft);
        renderCurrentStep(draft, validation, io);
        renderCommandHelp(io, draft.currentStep);
        continue;
      }

      if (EXIT_COMMANDS.has(command)) {
        io.stdout("Leaving the TUI shell. Session draft remains saved.");
        return;
      }

      if (draft.currentStep === "review" && isReviewReadOnlyCommand(command)) {
        io.stdout("Review is read-only. Use confirm to enable submit, submit to start the interactive Codex session, or quit to leave the draft unchanged.");
        renderCurrentStep(draft, validation, io);
        renderCommandHelp(io, draft.currentStep);
        continue;
      }

      if (draft.currentStep === "review" && CONFIRM_COMMANDS.has(command)) {
        if (!validation.isValid) {
          io.stdout(getResearchSessionWizardStepDefinition("review").blockedMessage);
          renderCurrentStep(draft, validation, io);
          continue;
        }

        if (draft.reviewConfirmed) {
          io.stdout("Final confirmation already recorded. Submit is available.");
        } else {
          draft = await draftService.updateDraft({
            repoRoot: session.repoRoot,
            sessionId: session.sessionId,
            patch: {
              reviewConfirmed: true,
            },
          });
          io.stdout("Final confirmation recorded. Submit is now available.");
        }
        validation = validateCurrentStep(draft);
        renderCurrentStep(draft, validation, io);
        renderCommandHelp(io, draft.currentStep);
        continue;
      }

      if (command === "back") {
        const backResult = getResearchSessionWizardBackResult(draft.currentStep);
        if (backResult.transition === "blocked" || !backResult.patch) {
          io.stdout(backResult.message);
          continue;
        }

        draft = await draftService.updateDraft({
          repoRoot: session.repoRoot,
          sessionId: session.sessionId,
          patch: backResult.patch,
        });
        io.stdout(backResult.message);
        validation = validateCurrentStep(draft);
        renderCurrentStep(draft, validation, io);
        renderCommandHelp(io, draft.currentStep);
        continue;
      }

      if (NEXT_COMMANDS.has(command)) {
        const nextResult = getResearchSessionWizardNextResult(draft.currentStep);
        if (nextResult.transition === "blocked" || !nextResult.patch) {
          io.stdout(nextResult.message);
          continue;
        }

        draft = await draftService.updateDraft({
          repoRoot: session.repoRoot,
          sessionId: session.sessionId,
          patch: nextResult.patch,
        });
        io.stdout(nextResult.message);
        validation = validateCurrentStep(draft);
        renderCurrentStep(draft, validation, io);
        renderCommandHelp(io, draft.currentStep);
        continue;
      }

      if (isAdvanceCommand(command, draft.currentStep)) {
        const advanceResult = getResearchSessionWizardAdvanceResult(draft);
        validation = advanceResult.validation;
        if (advanceResult.transition === "blocked") {
          io.stdout(advanceResult.message);
          renderCurrentStep(draft, validation, io);
          continue;
        }

        if (advanceResult.transition === "step_changed" && advanceResult.patch) {
          draft = await draftService.updateDraft({
            repoRoot: session.repoRoot,
            sessionId: session.sessionId,
            patch: advanceResult.patch,
          });
          io.stdout(advanceResult.message);
          validation = validateCurrentStep(draft);
          renderCurrentStep(draft, validation, io);
          renderCommandHelp(io, draft.currentStep);
          continue;
        }

        io.stdout(advanceResult.message);
        try {
          if (advanceResult.patch) {
            draft = await draftService.updateDraft({
              repoRoot: session.repoRoot,
              sessionId: session.sessionId,
              patch: advanceResult.patch,
            });
          }
          const launchResult = await interactiveSessionService.launchFromDraft({
            repoRoot: session.repoRoot,
            draftSessionId: session.sessionId,
          });
          io.stdout(`Session: ${launchResult.sessionId}`);
          io.stdout(`Lifecycle evidence: ${launchResult.lifecyclePath}`);
          if (launchResult.finalized.step === "session_interrupted") {
            io.stdout("Session ended before a completed cycle checkpoint and is awaiting resume.");
          } else {
            io.stdout("Session failed before reaching a completed cycle checkpoint.");
          }
          return;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to start the interactive Codex session.";
          io.stderr(message);
          renderCommandHelp(io, draft.currentStep);
          continue;
        }
      }

      if (command.startsWith("edit ")) {
        const fieldKey = command.slice(5).trim();
        const field = STEP_FIELD_LOOKUP[draft.currentStep].get(fieldKey);
        if (!field) {
          io.stdout(`Unknown field: ${fieldKey}`);
          renderCommandHelp(io, draft.currentStep);
          continue;
        }

        draft = await editField({
          field,
          session,
          readline,
          draftService,
        });
        validation = validateCurrentStep(draft);
        renderEditedFieldValidation(field, validation, io);
        renderCurrentStep(draft, validation, io);
        continue;
      }

      io.stdout(`Unknown command: ${command}`);
      renderCommandHelp(io, draft.currentStep);
    }
  } finally {
    readline.close();
  }
};

function renderSessionSummary(
  session: ResearchSessionLaunchResult,
  draft: ResearchSessionDraft,
  io: CommandIO,
): void {
  io.stdout("rrx v1 research shell");
  io.stdout(`launch: ${session.status}`);
  io.stdout(`session: ${session.sessionId}`);
  io.stdout(`goal: ${formatDisplayValue(draft.goal)}`);
  io.stdout(`cwd: ${session.repoRoot}`);
  io.stdout(`session_path: ${session.sessionPath}`);
  io.stdout(buildStartupStateLine(session));
}

function buildStartupStateLine(session: ResearchSessionLaunchResult): string {
  const summary = session.selectedCandidateSummary;
  if (!summary) {
    return "State: draft ready. No autonomous research cycle has started.";
  }

  return [
    "State: existing session detected.",
    `Resume candidate ${summary.sessionId} is ${summary.status}`,
    `with ${summary.checkpoint.completedCycles} completed cycle${summary.checkpoint.completedCycles === 1 ? "" : "s"}`,
    `and can continue from cycle ${summary.resumeFromCycle}.`,
  ].join(" ");
}

function renderExistingSessionSummary(
  input: {
    existingSession: ExistingResearchSessionInspection;
    selectedCandidateSummary?: SelectedCandidateSummary;
  },
  io: CommandIO,
): void {
  const summary = input.selectedCandidateSummary;
  const checkpointCompletedCycles =
    summary?.checkpoint.completedCycles ?? input.existingSession.session.progress.completedCycles;
  const resumeFromCycle = summary?.resumeFromCycle ?? input.existingSession.session.resume.resumeFromCycle;
  const recovery = summary?.recovery;
  const lifecyclePhase = recovery?.codexPhase ?? input.existingSession.lifecycle?.phase ?? "missing";

  io.stdout("Existing session found:");
  io.stdout(`  session: ${summary?.sessionId ?? input.existingSession.session.sessionId} (${summary?.status ?? input.existingSession.session.status})`);
  io.stdout(
    `  checkpoint: completed=${checkpointCompletedCycles}, next=${resumeFromCycle}`,
  );
  if (summary) {
    io.stdout(`  goal: ${summary.goal}`);
    io.stdout(`  stop condition: ${summary.checkpoint.stopCondition}`);
    if (summary.latestCycle) {
    io.stdout(
      `  latest cycle: ${summary.latestCycle.outcome}; progress=${summary.latestCycle.meaningfulProgress ? "yes" : "no"}; diff=${summary.latestCycle.diffLineCount}; artifacts=${summary.latestCycle.newArtifactCount}`,
    );
    }
    io.stdout(
      `  decision: ${formatSelectedCandidateDecision(summary.userConfirmation.decision)} (${summary.userConfirmation.required ? "resume or new session required" : "auto"})`,
    );
  }
  io.stdout(
    `  recovery: ${recovery?.classification ?? input.existingSession.recovery.classification} (${recovery?.reason ?? input.existingSession.recovery.reason})`,
  );
  io.stdout(`  codex lifecycle: ${lifecyclePhase}`);
}

function renderCurrentStep(
  draft: ResearchSessionDraft,
  validation: ResearchSessionDraftValidationResult,
  io: CommandIO,
): void {
  const step = getResearchSessionWizardStepDefinition(draft.currentStep);
  const sectionStatuses = getResearchSessionWizardSectionStatuses(draft);
  if (draft.currentStep === "review") {
    renderReviewStep({
      stepLabel: step.title,
      draft,
      validation,
      sectionStatuses,
      io,
    });
    return;
  }

  renderStep({
    currentStep: draft.currentStep,
    stepLabel: step.title,
    draft,
    validation,
    fields: STEP_FIELDS[draft.currentStep],
    sectionStatuses,
    io,
  });
}

function renderStep(input: {
  currentStep: ResearchSessionDraftStep;
  stepLabel: string;
  draft: ResearchSessionDraft;
  validation: ResearchSessionDraftValidationResult;
  fields: readonly EditableField[];
  sectionStatuses: readonly ResearchSessionWizardSectionStatus[];
  io: CommandIO;
}): void {
  input.io.stdout(input.stepLabel);
  input.io.stdout(`  repo root: ${input.draft.repoRoot}`);
  input.io.stdout(`  working directory: ${input.draft.workingDirectory}`);
  input.io.stdout("  sections:");
  for (const sectionStatus of input.sectionStatuses) {
    input.io.stdout(`    - ${formatSectionStatus(sectionStatus)}`);
  }
  for (const field of input.fields) {
    input.io.stdout(`  ${field.id}. ${field.label}: ${formatDisplayValue(field.getValue(input.draft))}`);
    if (!field.validationField) {
      continue;
    }

    const fieldError = input.validation.fieldErrors[field.validationField];
    if (fieldError) {
      input.io.stdout(`     error: ${fieldError}`);
    }
  }

  input.io.stdout(`  ${formatAdvanceActionStatus(input.draft, input.validation)}`);
}

function renderReviewStep(input: {
  stepLabel: string;
  draft: ResearchSessionDraft;
  validation: ResearchSessionDraftValidationResult;
  sectionStatuses: readonly ResearchSessionWizardSectionStatus[];
  io: CommandIO;
}): void {
  input.io.stdout(input.stepLabel);
  input.io.stdout(`  repo root: ${input.draft.repoRoot}`);
  input.io.stdout(`  working directory: ${input.draft.workingDirectory}`);
  input.io.stdout("  sections:");
  for (const sectionStatus of input.sectionStatuses) {
    input.io.stdout(`    - ${formatSectionStatus(sectionStatus)}`);
  }

  input.io.stdout("  review summary:");
  for (const section of buildResearchSessionReviewSummary(input.draft)) {
    renderReviewSummarySection(input.io, section);
  }

  input.io.stdout(
    `  final confirmation: ${input.draft.reviewConfirmed ? "confirmed" : "pending (run confirm to enable submit)"}`,
  );

  input.io.stdout(`  ${formatAdvanceActionStatus(input.draft, input.validation)}`);
}

function renderCommandHelp(io: CommandIO, currentStep: ResearchSessionDraftStep): void {
  io.stdout(getResearchSessionWizardStepDefinition(currentStep).helpText);
}

function renderExistingSessionPrompt(input: {
  existingSession: ExistingResearchSessionInspection;
  selectedCandidateSummary?: SelectedCandidateSummary;
  io: CommandIO;
}): void {
  if (!isResumeOptionAvailable(input)) {
    return;
  }

  input.io.stdout("Resume or New Session:");
  input.io.stdout("  - resume: continue the resumable session from its last completed cycle boundary");
  input.io.stdout("  - new session: keep the saved draft and start a fresh session review");
}

function renderExistingSessionHelp(input: {
  existingSession: ExistingResearchSessionInspection;
  selectedCandidateSummary?: SelectedCandidateSummary;
  io: CommandIO;
}): void {
  if (isResumeOptionAvailable(input)) {
    input.io.stdout("Commands: resume, inspect, new session, help, quit");
    return;
  }

  input.io.stdout("Commands: inspect, new session, help, quit");
}

function renderEditedFieldValidation(
  field: EditableField,
  validation: ResearchSessionDraftValidationResult,
  io: CommandIO,
): void {
  if (!field.validationField) {
    return;
  }

  const fieldError = validation.fieldErrors[field.validationField];
  if (fieldError) {
    io.stdout(`${field.label} error: ${fieldError}`);
    return;
  }

  io.stdout(`${field.label} ready.`);
}

function renderReviewSummarySection(
  io: CommandIO,
  input: ResearchSessionReviewSummarySection,
): void {
  io.stdout(`  ${input.label}`);
  for (const field of input.fields) {
    io.stdout(`     ${field.label}: ${formatDisplayValue(field.value)}`);
  }

  if (input.validation.isValid) {
    return;
  }

  for (const message of Object.values(input.validation.fieldErrors)) {
    if (!message) {
      continue;
    }
    io.stdout(`     error: ${message}`);
  }
}

async function editField(input: {
  field: EditableField;
  session: ResearchSessionLaunchResult;
  readline: QuestioningInterface;
  draftService: Pick<ResearchSessionDraftService, "updateDraft">;
}): Promise<ResearchSessionDraft> {
  const value = await input.readline.question(input.field.prompt);

  return input.draftService.updateDraft({
    repoRoot: input.session.repoRoot,
    sessionId: input.session.sessionId,
    patch: input.field.createPatch(value),
  });
}

function isInteractiveTerminal(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): boolean {
  return Boolean((input as { isTTY?: boolean }).isTTY && (output as { isTTY?: boolean }).isTTY);
}

function validateCurrentStep(draft: ResearchSessionDraft): ResearchSessionDraftValidationResult {
  return validateResearchSessionWizardStep(draft);
}

function isAdvanceCommand(command: string, currentStep: ResearchSessionDraftStep): boolean {
  return isResearchSessionWizardAdvanceCommand(command, currentStep);
}

function isReviewReadOnlyCommand(command: string): boolean {
  return command === "back" || NEXT_COMMANDS.has(command) || command.startsWith("edit ");
}

function createFieldLookup(fields: readonly EditableField[]): Map<string, EditableField> {
  return new Map(
    fields.flatMap((field) => [
      [field.id, field],
      ...field.aliases.map((alias) => [alias, field] as const),
    ]),
  );
}

function formatDisplayValue(value: string): string {
  const normalized = value.trim();
  return normalized ? normalized : "<blank>";
}

function formatAdvanceActionStatus(
  draft: ResearchSessionDraft,
  validation: ResearchSessionDraftValidationResult,
): string {
  const actionLabel = draft.currentStep === "review" ? "submit" : "continue";
  if (validation.isValid) {
    if (draft.currentStep === "review" && !draft.reviewConfirmed) {
      return `${actionLabel}: blocked until final confirmation`;
    }

    return `${actionLabel}: ready`;
  }

  const blockingFields = STEP_FIELDS[draft.currentStep]
    .filter((field) => field.validationField && validation.fieldErrors[field.validationField])
    .map((field) => field.label.toLowerCase());

  if (blockingFields.length === 0) {
    return `${actionLabel}: blocked`;
  }

  return `${actionLabel}: blocked by ${blockingFields.join(", ")}`;
}

function formatSectionStatus(status: ResearchSessionWizardSectionStatus): string {
  const parts: string[] = [];

  if (status.isCurrent) {
    parts.push("current");
  }

  parts.push(status.isCompleted ? "completed" : "pending");

  if (status.validation.isValid) {
    parts.push("valid");
  } else {
    parts.push(`invalid (${formatSectionValidationErrors(status)})`);
  }

  return `${status.label}: ${parts.join(", ")}`;
}

function formatSectionValidationErrors(status: ResearchSessionWizardSectionStatus): string {
  const fields = STEP_FIELDS[status.step];
  const blockingFields = fields
    .filter((field) => field.validationField && status.validation.fieldErrors[field.validationField])
    .map((field) => field.label.toLowerCase());

  return blockingFields.length > 0 ? blockingFields.join(", ") : "errors";
}

async function promptExistingSessionAction(input: {
  existingSession: ExistingResearchSessionInspection;
  selectedCandidateSummary?: SelectedCandidateSummary;
  repoRoot: string;
  io: CommandIO;
  readline: QuestioningInterface;
}): Promise<ResearchSessionShellEntrySelection | "new" | "quit"> {
  renderExistingSessionSummary(input, input.io);
  renderExistingSessionPrompt(input);
  renderExistingSessionHelp(input);

  while (true) {
    const command = (await input.readline.question("session> ")).trim().toLowerCase();

    if (!command || HELP_COMMANDS.has(command)) {
      renderExistingSessionSummary(input, input.io);
      renderExistingSessionPrompt(input);
      renderExistingSessionHelp(input);
      continue;
    }

    if (EXIT_COMMANDS.has(command)) {
      input.io.stdout("Leaving the TUI shell. Session draft remains saved.");
      return "quit";
    }

    if (NEW_COMMANDS.has(command)) {
      input.io.stdout("Starting a fresh draft review.");
      return "new";
    }

    if (INSPECT_COMMANDS.has(command)) {
      renderExistingSessionInspection(input.existingSession, input.io);
      continue;
    }

    if (RESUME_COMMANDS.has(command)) {
      if (!isResumeOptionAvailable(input)) {
        input.io.stdout(`resume blocked: ${input.existingSession.recovery.reason}`);
        renderExistingSessionHelp(input);
        continue;
      }

      return {
        entrySelection: "resume",
        sessionId: input.existingSession.session.sessionId,
      };
    }

    input.io.stdout(`Unknown command: ${command}`);
    renderExistingSessionHelp(input);
  }
}

function formatSelectedCandidateDecision(
  decision: SelectedCandidateSummary["userConfirmation"]["decision"] | undefined,
): string {
  if (!decision) {
    return "pending";
  }

  if (decision === "new_session") {
    return "new session";
  }

  return decision;
}

function isResumeOptionAvailable(input: {
  existingSession: ExistingResearchSessionInspection;
  selectedCandidateSummary?: SelectedCandidateSummary;
}): boolean {
  return input.selectedCandidateSummary?.recovery?.resumeAllowed ?? input.existingSession.recovery.resumeAllowed;
}

function renderExistingSessionInspection(
  existingSession: ExistingResearchSessionInspection,
  io: CommandIO,
): void {
  io.stdout(`session_id: ${existingSession.session.sessionId}`);
  io.stdout(`status: ${existingSession.session.status}`);
  io.stdout(`goal: ${formatDisplayValue(existingSession.session.goal)}`);
  io.stdout(
    `checkpoint: completed=${existingSession.session.progress.completedCycles}, next=${existingSession.session.progress.nextCycle}`,
  );
  io.stdout(`stop_condition: ${existingSession.session.stopCondition.type}`);
  io.stdout(
    `recovery: ${existingSession.recovery.classification} (${existingSession.recovery.reason})`,
  );
  io.stdout(`runtime: ${existingSession.recovery.runtime.state}`);
  if (existingSession.lifecycle) {
    io.stdout(`codex_phase: ${existingSession.lifecycle.phase}`);
    io.stdout(`codex_updated_at: ${existingSession.lifecycle.updatedAt}`);
    if (existingSession.lifecycle.pid !== undefined) {
      io.stdout(`codex_pid: ${existingSession.lifecycle.pid}`);
    }
  } else {
    io.stdout("codex_phase: missing");
  }
}
