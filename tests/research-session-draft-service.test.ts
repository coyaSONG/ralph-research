import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildResearchSessionReviewSummary,
  ResearchSessionDraftService,
} from "../src/app/services/research-session-draft-service.js";
import { ResearchSessionLaunchService } from "../src/app/services/research-session-launch-service.js";
import { getResearchSessionWizardAdvanceResult } from "../src/app/services/research-session-wizard-controller.js";
import { researchProjectDefaultsRecordSchema } from "../src/core/model/research-project-defaults.js";
import { researchSessionRecordSchema } from "../src/core/model/research-session.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-draft-service-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("ResearchSessionDraftService", () => {
  it("stores permissions, stop-rules, and outputs form state in shared flow state and reloads it on revisit", async () => {
    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const draftService = new ResearchSessionDraftService({
      now: () => new Date("2026-04-12T00:05:00.000Z"),
    });
    const launch = await launchService.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });

    await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        currentStep: "permissions",
        workingDirectory: tempRoot,
        contextSettings: {
          webSearch: "disabled",
          shellCommandAllowlistAdditions: "git status, ls",
          shellCommandAllowlistRemovals: "rm, mv",
        },
        agentSettings: {
          approvalPolicy: "on-request",
          sandboxMode: "read-only",
        },
      },
    });
    await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        currentStep: "stopRules",
        stopPolicy: {
          repeatedFailures: "7",
          noMeaningfulProgress: "8",
          insufficientEvidence: "9",
        },
      },
    });
    await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        currentStep: "outputs",
        goal: "beat 70 percent future holdout top-3 accuracy",
        agentCommand: "codex --model gpt-5.4",
        contextSettings: {
          trackableGlobs: "**/*.ts, reports/**/*.json",
        },
        workspaceSettings: {
          baseRef: "HEAD",
        },
        agentSettings: {
          model: "gpt-5.4",
          startupTimeoutSec: "45",
          turnTimeoutSec: "1200",
        },
      },
    });

    const persisted = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(launch.sessionPath, "utf8")),
    );

    expect(persisted.draftState?.flowState).toEqual({
      permissions: {
        workingDirectory: tempRoot,
        webSearch: "disabled",
        shellCommandAllowlistAdditions: "git status, ls",
        shellCommandAllowlistRemovals: "rm, mv",
        approvalPolicy: "on-request",
        sandboxMode: "read-only",
      },
      stopRules: {
        repeatedFailures: "7",
        noMeaningfulProgress: "8",
        insufficientEvidence: "9",
      },
      outputs: {
        goal: "beat 70 percent future holdout top-3 accuracy",
        trackableGlobs: "**/*.ts, reports/**/*.json",
        baseRef: "HEAD",
        agentCommand: "codex --model gpt-5.4",
        model: "gpt-5.4",
        startupTimeoutSec: "45",
        turnTimeoutSec: "1200",
      },
      review: {
        sections: [
          {
            index: "1",
            label: "Permissions",
            step: "permissions",
            fields: [
              { label: "Working directory", value: tempRoot },
              { label: "Web search", value: "disabled" },
              { label: "Shell allowlist additions", value: "git status, ls" },
              { label: "Shell allowlist removals", value: "rm, mv" },
              { label: "Approval policy", value: "on-request" },
              { label: "Sandbox mode", value: "read-only" },
            ],
          },
          {
            index: "2",
            label: "Stop Rules",
            step: "stopRules",
            fields: [
              { label: "Repeated failures threshold", value: "7" },
              { label: "No-progress threshold", value: "8" },
              { label: "Insufficient-evidence threshold", value: "9" },
            ],
          },
          {
            index: "3",
            label: "Outputs",
            step: "outputs",
            fields: [
              { label: "Goal", value: "beat 70 percent future holdout top-3 accuracy" },
              { label: "Trackable files", value: "**/*.ts, reports/**/*.json" },
              { label: "Baseline ref", value: "HEAD" },
              { label: "Agent command", value: "codex --model gpt-5.4" },
              { label: "Model override", value: "gpt-5.4" },
              { label: "Startup timeout (sec)", value: "45" },
              { label: "Turn timeout (sec)", value: "1200" },
            ],
          },
        ],
      },
    });

    await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        currentStep: "permissions",
      },
    });

    const revisitedPermissions = await draftService.loadDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
    });
    expect(revisitedPermissions.currentStep).toBe("permissions");
    expect(revisitedPermissions.contextSettings.webSearch).toBe("disabled");
    expect(revisitedPermissions.contextSettings.shellCommandAllowlistAdditions).toBe("git status, ls");
    expect(revisitedPermissions.contextSettings.shellCommandAllowlistRemovals).toBe("rm, mv");
    expect(revisitedPermissions.agentSettings.approvalPolicy).toBe("on-request");
    expect(revisitedPermissions.agentSettings.sandboxMode).toBe("read-only");

    await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        currentStep: "stopRules",
      },
    });

    const revisitedStopRules = await draftService.loadDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
    });
    expect(revisitedStopRules.currentStep).toBe("stopRules");
    expect(revisitedStopRules.stopPolicy).toEqual({
      repeatedFailures: "7",
      noMeaningfulProgress: "8",
      insufficientEvidence: "9",
    });

    await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        currentStep: "outputs",
      },
    });

    const revisitedOutputs = await draftService.loadDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
    });
    expect(revisitedOutputs.currentStep).toBe("outputs");
    expect(revisitedOutputs.goal).toBe("beat 70 percent future holdout top-3 accuracy");
    expect(revisitedOutputs.contextSettings.trackableGlobs).toBe("**/*.ts, reports/**/*.json");
    expect(revisitedOutputs.workspaceSettings.baseRef).toBe("HEAD");
    expect(revisitedOutputs.agentCommand).toBe("codex --model gpt-5.4");
    expect(revisitedOutputs.agentSettings).toMatchObject({
      model: "gpt-5.4",
      startupTimeoutSec: "45",
      turnTimeoutSec: "1200",
    });
  });

  it("persists reusable project defaults outside the launch-draft session snapshot", async () => {
    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const draftService = new ResearchSessionDraftService({
      now: () => new Date("2026-04-12T00:05:00.000Z"),
    });
    const canonicalRoot = await realpath(tempRoot);
    const launch = await launchService.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });
    const workingDirectory = join(canonicalRoot, "artifacts");

    await mkdir(workingDirectory);
    await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        currentStep: "outputs",
        workingDirectory,
        contextSettings: {
          webSearch: "disabled",
          trackableGlobs: "reports/**/*.json, src/**/*.ts",
          shellCommandAllowlistAdditions: "git status, git diff",
          shellCommandAllowlistRemovals: "rm, mv",
        },
        workspaceSettings: {
          baseRef: "origin/main",
        },
        agentCommand: "codex --model gpt-5.4",
        stopPolicy: {
          repeatedFailures: "7",
          noMeaningfulProgress: "8",
          insufficientEvidence: "4",
        },
        agentSettings: {
          model: "gpt-5.4",
          approvalPolicy: "on-request",
          sandboxMode: "read-only",
          startupTimeoutSec: "45",
          turnTimeoutSec: "1200",
        },
      },
    });

    const defaultsPath = join(canonicalRoot, ".ralph", "project-defaults.json");
    const rawDefaults = JSON.parse(await readFile(defaultsPath, "utf8"));
    const persistedDefaults = researchProjectDefaultsRecordSchema.parse(rawDefaults);

    expect(persistedDefaults).toMatchObject({
      workingDirectory,
      context: {
        trackableGlobs: ["reports/**/*.json", "src/**/*.ts"],
        webSearch: false,
        shellCommandAllowlistAdditions: ["git status", "git diff"],
        shellCommandAllowlistRemovals: ["rm", "mv"],
      },
      workspace: {
        strategy: "git_worktree",
        baseRef: "origin/main",
      },
      agent: {
        type: "codex_cli",
        command: "codex --model gpt-5.4",
        model: "gpt-5.4",
        approvalPolicy: "on-request",
        sandboxMode: "read-only",
        ttySession: {
          startupTimeoutSec: 45,
          turnTimeoutSec: 1200,
        },
      },
      stopPolicy: {
        repeatedFailures: 7,
        noMeaningfulProgress: 8,
        insufficientEvidence: 4,
      },
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:05:00.000Z",
    });
    expect(rawDefaults.goal).toBeUndefined();
    expect(rawDefaults.draftState).toBeUndefined();
    expect(rawDefaults.progress).toBeUndefined();
  });

  it("derives future-session defaults from the review contract instead of polluted runtime session fields", async () => {
    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const draftService = new ResearchSessionDraftService({
      now: () => new Date("2026-04-12T00:05:00.000Z"),
    });
    const canonicalRoot = await realpath(tempRoot);
    const launch = await launchService.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });
    const reviewDirectory = join(canonicalRoot, "reports");
    const runtimeWorkspacePath = join(
      canonicalRoot,
      ".ralph",
      "sessions",
      launch.sessionId,
      "workspace-runtime",
    );

    await mkdir(reviewDirectory, { recursive: true });
    await mkdir(runtimeWorkspacePath, { recursive: true });

    await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        currentStep: "review",
        completedSteps: ["permissions", "stopRules", "outputs", "review"],
        reviewConfirmed: false,
        workingDirectory: reviewDirectory,
        contextSettings: {
          webSearch: "disabled",
          trackableGlobs: "reports/**/*.json, src/**/*.ts",
          shellCommandAllowlistAdditions: "git status, git diff",
          shellCommandAllowlistRemovals: "rm, mv",
        },
        workspaceSettings: {
          baseRef: "origin/main",
        },
        agentCommand: "codex --model gpt-5.4 --full-auto",
        stopPolicy: {
          repeatedFailures: "4",
          noMeaningfulProgress: "6",
          insufficientEvidence: "2",
        },
        agentSettings: {
          model: "gpt-5.4",
          approvalPolicy: "on-request",
          sandboxMode: "read-only",
          startupTimeoutSec: "45",
          turnTimeoutSec: "1200",
        },
      },
    });

    const pollutedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(launch.sessionPath, "utf8")),
    );
    await writeFile(
      launch.sessionPath,
      `${JSON.stringify(
        {
          ...pollutedDraft,
          workingDirectory: runtimeWorkspacePath,
          context: {
            ...pollutedDraft.context,
            trackableGlobs: [".ralph/sessions/**"],
            webSearch: true,
            shellCommandAllowlistAdditions: ["codex resume", "git worktree list"],
            shellCommandAllowlistRemovals: ["git status"],
          },
          workspace: {
            ...pollutedDraft.workspace,
            baseRef: "refs/heads/session-runtime",
            currentRef: "refs/heads/session-runtime",
            currentPath: runtimeWorkspacePath,
            promoted: false,
          },
          agent: {
            ...pollutedDraft.agent,
            command: "codex resume session-runtime",
            model: "gpt-5.4-mini",
            approvalPolicy: "never",
            sandboxMode: "workspace-write",
            ttySession: {
              startupTimeoutSec: 5,
              turnTimeoutSec: 90,
            },
          },
          stopPolicy: {
            repeatedFailures: 9,
            noMeaningfulProgress: 9,
            insufficientEvidence: 9,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        currentStep: "review",
        reviewConfirmed: true,
      },
    });

    const persistedDefaults = researchProjectDefaultsRecordSchema.parse(
      JSON.parse(
        await readFile(join(canonicalRoot, ".ralph", "project-defaults.json"), "utf8"),
      ),
    );

    expect(persistedDefaults).toMatchObject({
      workingDirectory: reviewDirectory,
      context: {
        trackableGlobs: ["reports/**/*.json", "src/**/*.ts"],
        webSearch: false,
        shellCommandAllowlistAdditions: ["git status", "git diff"],
        shellCommandAllowlistRemovals: ["rm", "mv"],
      },
      workspace: {
        strategy: "git_worktree",
        baseRef: "origin/main",
      },
      agent: {
        type: "codex_cli",
        command: "codex --model gpt-5.4 --full-auto",
        model: "gpt-5.4",
        approvalPolicy: "on-request",
        sandboxMode: "read-only",
        ttySession: {
          startupTimeoutSec: 45,
          turnTimeoutSec: 1200,
        },
      },
      stopPolicy: {
        repeatedFailures: 4,
        noMeaningfulProgress: 6,
        insufficientEvidence: 2,
      },
    });
    expect(persistedDefaults.workingDirectory).not.toBe(runtimeWorkspacePath);
    expect(persistedDefaults.workspace.baseRef).not.toBe("refs/heads/session-runtime");
    expect(persistedDefaults.agent.command).not.toBe("codex resume session-runtime");
  });

  it("builds the review summary from the accumulated persisted draft state", async () => {
    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const draftService = new ResearchSessionDraftService({
      now: () => new Date("2026-04-12T00:05:00.000Z"),
    });
    const launch = await launchService.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });

    await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        currentStep: "permissions",
        contextSettings: {
          webSearch: "disabled",
          shellCommandAllowlistAdditions: "git status, rg",
        },
        agentSettings: {
          approvalPolicy: "on-request",
        },
      },
    });
    await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        currentStep: "stopRules",
        stopPolicy: {
          repeatedFailures: "4",
          noMeaningfulProgress: "6",
          insufficientEvidence: "5",
        },
      },
    });
    await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        currentStep: "outputs",
        goal: "improve future holdout top-3 accuracy",
        agentCommand: "codex --model gpt-5.4",
        contextSettings: {
          trackableGlobs: "**/*.ts, reports/**/*.json",
        },
        workspaceSettings: {
          baseRef: "HEAD",
        },
        agentSettings: {
          startupTimeoutSec: "45",
          turnTimeoutSec: "1200",
        },
      },
    });

    const draft = await draftService.loadDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
    });
    expect(draft.reviewState).toEqual({
      sections: [
        {
          index: "1",
          label: "Permissions",
          step: "permissions",
          fields: [
            { label: "Working directory", value: draft.workingDirectory },
            { label: "Web search", value: "disabled" },
            { label: "Shell allowlist additions", value: "git status, rg" },
            { label: "Shell allowlist removals", value: "" },
            { label: "Approval policy", value: "on-request" },
            { label: "Sandbox mode", value: "workspace-write" },
          ],
        },
        {
          index: "2",
          label: "Stop Rules",
          step: "stopRules",
          fields: [
            { label: "Repeated failures threshold", value: "4" },
            { label: "No-progress threshold", value: "6" },
            { label: "Insufficient-evidence threshold", value: "5" },
          ],
        },
        {
          index: "3",
          label: "Outputs",
          step: "outputs",
          fields: [
            { label: "Goal", value: "improve future holdout top-3 accuracy" },
            { label: "Trackable files", value: "**/*.ts, reports/**/*.json" },
            { label: "Baseline ref", value: "HEAD" },
            { label: "Agent command", value: "codex --model gpt-5.4" },
            { label: "Model override", value: "" },
            { label: "Startup timeout (sec)", value: "45" },
            { label: "Turn timeout (sec)", value: "1200" },
          ],
        },
      ],
    });
    const summary = buildResearchSessionReviewSummary(draft);

    expect(summary).toEqual([
      {
        index: "1",
        label: "Permissions",
        step: "permissions",
        fields: [
          { label: "Working directory", value: draft.workingDirectory },
          { label: "Web search", value: "disabled" },
          { label: "Shell allowlist additions", value: "git status, rg" },
          { label: "Shell allowlist removals", value: "" },
          { label: "Approval policy", value: "on-request" },
          { label: "Sandbox mode", value: "workspace-write" },
        ],
        validation: {
          isValid: true,
          fieldErrors: {},
        },
      },
      {
        index: "2",
        label: "Stop Rules",
        step: "stopRules",
        fields: [
          { label: "Repeated failures threshold", value: "4" },
          { label: "No-progress threshold", value: "6" },
          { label: "Insufficient-evidence threshold", value: "5" },
        ],
        validation: {
          isValid: true,
          fieldErrors: {},
        },
      },
      {
        index: "3",
        label: "Outputs",
        step: "outputs",
        fields: [
          { label: "Goal", value: "improve future holdout top-3 accuracy" },
          { label: "Trackable files", value: "**/*.ts, reports/**/*.json" },
          { label: "Baseline ref", value: "HEAD" },
          { label: "Agent command", value: "codex --model gpt-5.4" },
          { label: "Model override", value: "" },
          { label: "Startup timeout (sec)", value: "45" },
          { label: "Turn timeout (sec)", value: "1200" },
        ],
        validation: {
          isValid: true,
          fieldErrors: {},
        },
      },
    ]);
  });

  it("persists review confirmation and clears it when the operator changes review inputs or steps", async () => {
    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const draftService = new ResearchSessionDraftService({
      now: () => new Date("2026-04-12T00:05:00.000Z"),
    });
    const launch = await launchService.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });

    let draft = await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        currentStep: "review",
        reviewConfirmed: true,
      },
    });

    expect(draft.reviewConfirmed).toBe(true);

    draft = await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        currentStep: "outputs",
      },
    });

    expect(draft.reviewConfirmed).toBe(false);

    draft = await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        reviewConfirmed: true,
      },
    });

    expect(draft.reviewConfirmed).toBe(true);

    draft = await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: {
        agentCommand: "codex --model gpt-5.4",
      },
    });

    expect(draft.reviewConfirmed).toBe(false);
  });

  it("persists the validated outputs advance payload into shared draft state for review and resume", async () => {
    const canonicalTempRoot = await realpath(tempRoot);
    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const draftService = new ResearchSessionDraftService({
      now: () => new Date("2026-04-12T00:05:00.000Z"),
    });
    const launch = await launchService.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });

    const loaded = await draftService.loadDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
    });
    const outputsDraft = {
      ...loaded,
      currentStep: "outputs" as const,
      completedSteps: ["permissions", "stopRules"] as const,
      goal: "beat 70 percent future holdout top-3 accuracy",
      contextSettings: {
        ...loaded.contextSettings,
        trackableGlobs: "**/*.ts, reports/**/*.json",
      },
      workspaceSettings: {
        ...loaded.workspaceSettings,
        baseRef: "HEAD~1",
      },
      agentCommand: "codex --model gpt-5.4 --full-auto",
      agentSettings: {
        ...loaded.agentSettings,
        model: "gpt-5.4",
        startupTimeoutSec: "45",
        turnTimeoutSec: "1200",
      },
    };

    const advance = getResearchSessionWizardAdvanceResult(outputsDraft);
    expect(advance).toMatchObject({
      transition: "step_changed",
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
    expect(advance.patch).toBeDefined();

    await draftService.updateDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
      patch: advance.patch!,
    });

    const persisted = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(launch.sessionPath, "utf8")),
    );
    expect(persisted.draftState?.flowState?.outputs).toEqual({
      goal: "beat 70 percent future holdout top-3 accuracy",
      trackableGlobs: "**/*.ts, reports/**/*.json",
      baseRef: "HEAD~1",
      agentCommand: "codex --model gpt-5.4 --full-auto",
      model: "gpt-5.4",
      startupTimeoutSec: "45",
      turnTimeoutSec: "1200",
    });
    expect(persisted.draftState?.flowState?.review).toEqual({
      sections: [
        {
          index: "1",
          label: "Permissions",
          step: "permissions",
          fields: [
            { label: "Working directory", value: canonicalTempRoot },
            { label: "Web search", value: "enabled" },
            { label: "Shell allowlist additions", value: "" },
            { label: "Shell allowlist removals", value: "" },
            { label: "Approval policy", value: "never" },
            { label: "Sandbox mode", value: "workspace-write" },
          ],
        },
        {
          index: "2",
          label: "Stop Rules",
          step: "stopRules",
          fields: [
            { label: "Repeated failures threshold", value: "3" },
            { label: "No-progress threshold", value: "5" },
            { label: "Insufficient-evidence threshold", value: "3" },
          ],
        },
        {
          index: "3",
          label: "Outputs",
          step: "outputs",
          fields: [
            { label: "Goal", value: "beat 70 percent future holdout top-3 accuracy" },
            { label: "Trackable files", value: "**/*.ts, reports/**/*.json" },
            { label: "Baseline ref", value: "HEAD~1" },
            { label: "Agent command", value: "codex --model gpt-5.4 --full-auto" },
            { label: "Model override", value: "gpt-5.4" },
            { label: "Startup timeout (sec)", value: "45" },
            { label: "Turn timeout (sec)", value: "1200" },
          ],
        },
      ],
    });
    expect(persisted.draftState?.goalStep).toMatchObject({
      goal: "beat 70 percent future holdout top-3 accuracy",
      agentCommand: "codex --model gpt-5.4 --full-auto",
    });
    expect(persisted.draftState?.contextStep).toMatchObject({
      trackableGlobs: "**/*.ts, reports/**/*.json",
    });
    expect(persisted.draftState?.workspaceStep).toMatchObject({
      baseRef: "HEAD~1",
    });
    expect(persisted.draftState?.agentStep).toMatchObject({
      command: "codex --model gpt-5.4 --full-auto",
      model: "gpt-5.4",
      startupTimeoutSec: "45",
      turnTimeoutSec: "1200",
    });

    const reviewDraft = await draftService.loadDraft({
      repoRoot: tempRoot,
      sessionId: launch.sessionId,
    });
    expect(reviewDraft.currentStep).toBe("review");
    expect(reviewDraft.goal).toBe("beat 70 percent future holdout top-3 accuracy");
    expect(reviewDraft.contextSettings.trackableGlobs).toBe("**/*.ts, reports/**/*.json");
    expect(reviewDraft.workspaceSettings.baseRef).toBe("HEAD~1");
    expect(reviewDraft.agentCommand).toBe("codex --model gpt-5.4 --full-auto");
    expect(reviewDraft.agentSettings).toMatchObject({
      model: "gpt-5.4",
      startupTimeoutSec: "45",
      turnTimeoutSec: "1200",
    });
    expect(reviewDraft.reviewState.sections[2]?.fields).toEqual([
      { label: "Goal", value: "beat 70 percent future holdout top-3 accuracy" },
      { label: "Trackable files", value: "**/*.ts, reports/**/*.json" },
      { label: "Baseline ref", value: "HEAD~1" },
      { label: "Agent command", value: "codex --model gpt-5.4 --full-auto" },
      { label: "Model override", value: "gpt-5.4" },
      { label: "Startup timeout (sec)", value: "45" },
      { label: "Turn timeout (sec)", value: "1200" },
    ]);
  });
});
