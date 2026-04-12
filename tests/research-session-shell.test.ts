import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JsonFileResearchSessionRepository } from "../src/adapters/fs/json-file-research-session-repository.js";
import { ResearchSessionLaunchService } from "../src/app/services/research-session-launch-service.js";
import { openResearchSessionShell } from "../src/cli/tui/research-session-shell.js";
import { researchSessionRecordSchema } from "../src/core/model/research-session.js";
import { createCapturingIo } from "./helpers/fixture-repo.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-session-shell-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("openResearchSessionShell", () => {
  it("renders the fixed four-step flow and only one active-step view when no interactive terminal is available", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });
    const io = createCapturingIo();

    await openResearchSessionShell(launch, io, {
      input: { isTTY: false } as NodeJS.ReadableStream,
      output: { isTTY: false } as NodeJS.WritableStream,
    });

    const output = io.stdoutText();

    expect(output).toContain("rrx v1 research shell");
    expect(output).toContain("Step 1/4: Permissions");
    expect(output).toContain("Permissions: current, pending, valid");
    expect(output).toContain("Stop Rules: pending, valid");
    expect(output).toContain("Outputs: pending, valid");
    expect(output).toContain("Review: pending, valid");
    expect(output).toContain("1. Working directory:");
    expect(output).toContain("2. Web search: enabled");
    expect(output).toContain("3. Shell allowlist additions: <blank>");
    expect(output).toContain("4. Shell allowlist removals: <blank>");
    expect(output).toContain("5. Approval policy: never");
    expect(output).toContain("6. Sandbox mode: workspace-write");
    expect(output).toContain("continue: ready");
    expect(output).toContain("Interactive terminal not detected. Session draft saved without starting a research cycle.");
    expect(output.match(/Step \d\/4:/g)).toHaveLength(1);
  });

  it("renders all permissions fields from the saved wizard state when the shell opens", async () => {
    const canonicalTempRoot = await realpath(tempRoot);
    const workingDirectory = join(canonicalTempRoot, "reports");
    await mkdir(workingDirectory);

    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: canonicalTempRoot,
    });
    const repository = new JsonFileResearchSessionRepository(join(canonicalTempRoot, ".ralph", "sessions"));
    const existingDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(launch.sessionPath, "utf8")),
    );

    await repository.saveSession(
      researchSessionRecordSchema.parse({
        ...existingDraft,
        context: {
          ...existingDraft.context,
          webSearch: true,
        },
        agent: {
          ...existingDraft.agent,
          approvalPolicy: "never",
          sandboxMode: "workspace-write",
        },
        draftState: {
          ...existingDraft.draftState!,
          currentStep: "permissions",
          flowState: {
            ...existingDraft.draftState!.flowState!,
            permissions: {
              workingDirectory,
              webSearch: "disabled",
              shellCommandAllowlistAdditions: "git status, npm test",
              shellCommandAllowlistRemovals: "rm, git push",
              approvalPolicy: "on-request",
              sandboxMode: "read-only",
            },
          },
          contextStep: {
            ...existingDraft.draftState!.contextStep!,
            webSearch: "disabled",
            shellCommandAllowlistAdditions: "git status, npm test",
            shellCommandAllowlistRemovals: "rm, git push",
          },
          workspaceStep: {
            ...existingDraft.draftState!.workspaceStep!,
            workingDirectory,
          },
          agentStep: {
            ...existingDraft.draftState!.agentStep!,
            approvalPolicy: "on-request",
            sandboxMode: "read-only",
          },
        },
      }),
    );

    const io = createCapturingIo();

    await openResearchSessionShell(launch, io, {
      input: { isTTY: false } as NodeJS.ReadableStream,
      output: { isTTY: false } as NodeJS.WritableStream,
    });

    const output = io.stdoutText();

    expect(output).toContain(`1. Working directory: ${workingDirectory}`);
    expect(output).toContain("2. Web search: disabled");
    expect(output).toContain("3. Shell allowlist additions: git status, npm test");
    expect(output).toContain("4. Shell allowlist removals: rm, git push");
    expect(output).toContain("5. Approval policy: on-request");
    expect(output).toContain("6. Sandbox mode: read-only");
    expect(output).not.toContain("2. Web search: enabled");
    expect(output).not.toContain("5. Approval policy: never");
    expect(output).not.toContain("6. Sandbox mode: workspace-write");
  });

  it("renders all stop-rule fields from the saved wizard state when the shell opens", async () => {
    const canonicalTempRoot = await realpath(tempRoot);

    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: canonicalTempRoot,
    });
    const repository = new JsonFileResearchSessionRepository(join(canonicalTempRoot, ".ralph", "sessions"));
    const existingDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(launch.sessionPath, "utf8")),
    );

    await repository.saveSession(
      researchSessionRecordSchema.parse({
        ...existingDraft,
        draftState: {
          ...existingDraft.draftState!,
          currentStep: "stopRules",
          flowState: {
            ...existingDraft.draftState!.flowState!,
            stopRules: {
              repeatedFailures: "6",
              noMeaningfulProgress: "8",
              insufficientEvidence: "4",
            },
          },
        },
      }),
    );

    const io = createCapturingIo();

    await openResearchSessionShell(launch, io, {
      input: { isTTY: false } as NodeJS.ReadableStream,
      output: { isTTY: false } as NodeJS.WritableStream,
    });

    const output = io.stdoutText();

    expect(output).toContain("Step 2/4: Stop Rules");
    expect(output).toContain("1. Repeated failures threshold: 6");
    expect(output).toContain("2. No-progress threshold: 8");
    expect(output).toContain("3. Insufficient-evidence threshold: 4");
    expect(output).not.toContain("1. Repeated failures threshold: 3");
    expect(output).not.toContain("2. No-progress threshold: 5");
    expect(output).not.toContain("3. Insufficient-evidence threshold: 3");
  });

  it("renders all outputs fields from the saved wizard state when the shell opens", async () => {
    const canonicalTempRoot = await realpath(tempRoot);

    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: canonicalTempRoot,
    });
    const repository = new JsonFileResearchSessionRepository(join(canonicalTempRoot, ".ralph", "sessions"));
    const existingDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(launch.sessionPath, "utf8")),
    );

    await repository.saveSession(
      researchSessionRecordSchema.parse({
        ...existingDraft,
        goal: "stale persisted goal",
        agent: {
          ...existingDraft.agent,
          command: "codex --model stale",
          model: "stale",
          ttySession: {
            startupTimeoutSec: 30,
            turnTimeoutSec: 900,
          },
        },
        context: {
          ...existingDraft.context,
          trackableGlobs: ["stale/**/*.md"],
        },
        workspace: {
          ...existingDraft.workspace,
          baseRef: "main",
        },
        draftState: {
          ...existingDraft.draftState!,
          currentStep: "outputs",
          flowState: {
            ...existingDraft.draftState!.flowState!,
            outputs: {
              goal: "beat 70 percent future holdout top-3 accuracy",
              trackableGlobs: "**/*.ts, reports/**/*.json",
              baseRef: "HEAD",
              agentCommand: "codex --model gpt-5.4 --full-auto",
              model: "gpt-5.4",
              startupTimeoutSec: "45",
              turnTimeoutSec: "1200",
            },
          },
          goalStep: {
            ...existingDraft.draftState!.goalStep!,
            goal: "beat 70 percent future holdout top-3 accuracy",
            agentCommand: "codex --model gpt-5.4 --full-auto",
          },
          contextStep: {
            ...existingDraft.draftState!.contextStep!,
            trackableGlobs: "**/*.ts, reports/**/*.json",
          },
          workspaceStep: {
            ...existingDraft.draftState!.workspaceStep!,
            baseRef: "HEAD",
          },
          agentStep: {
            ...existingDraft.draftState!.agentStep!,
            command: "codex --model gpt-5.4 --full-auto",
            model: "gpt-5.4",
            startupTimeoutSec: "45",
            turnTimeoutSec: "1200",
          },
        },
      }),
    );

    const io = createCapturingIo();

    await openResearchSessionShell(launch, io, {
      input: { isTTY: false } as NodeJS.ReadableStream,
      output: { isTTY: false } as NodeJS.WritableStream,
    });

    const output = io.stdoutText();

    expect(output).toContain("Step 3/4: Outputs");
    expect(output).toContain("1. Goal: beat 70 percent future holdout top-3 accuracy");
    expect(output).toContain("2. Trackable files: **/*.ts, reports/**/*.json");
    expect(output).toContain("3. Baseline ref: HEAD");
    expect(output).toContain("4. Agent command: codex --model gpt-5.4 --full-auto");
    expect(output).toContain("5. Model override: gpt-5.4");
    expect(output).toContain("6. Startup timeout (sec): 45");
    expect(output).toContain("7. Turn timeout (sec): 1200");
    expect(output).not.toContain("1. Goal: stale persisted goal");
    expect(output).not.toContain("2. Trackable files: stale/**/*.md");
    expect(output).not.toContain("3. Baseline ref: main");
    expect(output).not.toContain("4. Agent command: codex --model stale");
    expect(output).not.toContain("5. Model override: stale");
    expect(output).not.toContain("6. Startup timeout (sec): 30");
    expect(output).not.toContain("7. Turn timeout (sec): 900");
  });

  it("renders the review screen from the composed review payload", async () => {
    const canonicalTempRoot = await realpath(tempRoot);

    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: canonicalTempRoot,
    });
    const repository = new JsonFileResearchSessionRepository(join(canonicalTempRoot, ".ralph", "sessions"));
    const existingDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(launch.sessionPath, "utf8")),
    );

    await repository.saveSession(
      researchSessionRecordSchema.parse({
        ...existingDraft,
        draftState: {
          ...existingDraft.draftState!,
          currentStep: "review",
          completedSteps: ["permissions", "stopRules", "outputs", "review"],
          flowState: {
            ...existingDraft.draftState!.flowState!,
            permissions: {
              workingDirectory: canonicalTempRoot,
              webSearch: "enabled",
              shellCommandAllowlistAdditions: "",
              shellCommandAllowlistRemovals: "",
              approvalPolicy: "never",
              sandboxMode: "workspace-write",
            },
            stopRules: {
              repeatedFailures: "3",
              noMeaningfulProgress: "5",
              insufficientEvidence: "3",
            },
            outputs: {
              goal: "stale review goal",
              trackableGlobs: "stale/**/*.md",
              baseRef: "main",
              agentCommand: "codex --model stale",
              model: "stale",
              startupTimeoutSec: "30",
              turnTimeoutSec: "900",
            },
            review: {
              sections: [
                {
                  index: "1",
                  label: "Permissions",
                  step: "permissions",
                  fields: [
                    { label: "Working directory", value: canonicalTempRoot },
                    { label: "Web search", value: "disabled" },
                    { label: "Shell allowlist additions", value: "git status, rg" },
                    { label: "Shell allowlist removals", value: "rm" },
                    { label: "Approval policy", value: "on-request" },
                    { label: "Sandbox mode", value: "read-only" },
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
                    { label: "Model override", value: "gpt-5.4" },
                    { label: "Startup timeout (sec)", value: "45" },
                    { label: "Turn timeout (sec)", value: "1200" },
                  ],
                },
              ],
            },
          },
        },
      }),
    );

    const io = createCapturingIo();

    await openResearchSessionShell(launch, io, {
      input: { isTTY: false } as NodeJS.ReadableStream,
      output: { isTTY: false } as NodeJS.WritableStream,
    });

    const output = io.stdoutText();

    expect(output).toContain("Step 4/4: Review");
    expect(output).toContain("  Permissions");
    expect(output).toContain("  Stop Rules");
    expect(output).toContain("  Outputs");
    expect(output).toContain("Web search: disabled");
    expect(output).toContain("Approval policy: on-request");
    expect(output).toContain("Repeated failures threshold: 4");
    expect(output).toContain("Goal: improve future holdout top-3 accuracy");
    expect(output).toContain("Trackable files: **/*.ts, reports/**/*.json");
    expect(output).toContain("Agent command: codex --model gpt-5.4");
    expect(output).toContain("Model override: gpt-5.4");
    expect(output).toContain("Startup timeout (sec): 45");
    expect(output).toContain("Turn timeout (sec): 1200");
    expect(output).not.toContain("Goal: stale review goal");
    expect(output).not.toContain("Trackable files: stale/**/*.md");
    expect(output).not.toContain("Agent command: codex --model stale");
    expect(output).not.toContain("Model override: stale");
    expect(output).not.toContain("1. Permissions");
    expect(output).not.toContain("2. Stop Rules");
    expect(output).not.toContain("3. Outputs");
  });

  it("shows inline permissions errors and stays on the step when continue is blocked by missing or invalid inputs", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });
    const io = createCapturingIo();

    await openResearchSessionShell(launch, io, {
      input: { isTTY: true } as NodeJS.ReadableStream,
      output: new CaptureWritable(),
      createReadline: createMockReadline([
        "edit working",
        "   ",
        "edit web",
        "sometimes",
        "edit approval",
        "sometimes",
        "edit sandbox",
        "unsafe",
        "continue",
        "quit",
      ]),
    });

    const savedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(launch.sessionPath, "utf8")),
    );
    const output = io.stdoutText();

    expect(savedDraft.workingDirectory).toBe(launch.repoRoot);
    expect(savedDraft.context.webSearch).toBe(true);
    expect(savedDraft.agent.approvalPolicy).toBe("never");
    expect(savedDraft.agent.sandboxMode).toBe("workspace-write");
    expect(savedDraft.draftState).toMatchObject({
      currentStep: "permissions",
      completedSteps: [],
      flowState: {
        permissions: {
          workingDirectory: "   ",
          webSearch: "sometimes",
          approvalPolicy: "sometimes",
          sandboxMode: "unsafe",
        },
      },
    });
    expect(output).toContain("Working directory error: Working directory is required");
    expect(output).toContain("Web search error: Web search must be enabled or disabled");
    expect(output).toContain(
      "Approval policy error: Approval policy must be one of: never, on-failure, on-request, untrusted",
    );
    expect(output).toContain(
      "Sandbox mode error: Sandbox mode must be one of: read-only, workspace-write, danger-full-access",
    );
    expect(output).toContain("Permissions step has validation errors. Fix them before continuing.");
    expect(output).toContain("Permissions: current, pending, invalid (working directory, web search, approval policy, sandbox mode)");
    expect(output).toContain("1. Working directory: <blank>");
    expect(output).toContain("error: Working directory is required");
    expect(output).toContain("2. Web search: sometimes");
    expect(output).toContain("error: Web search must be enabled or disabled");
    expect(output).toContain("5. Approval policy: sometimes");
    expect(output).toContain(
      "error: Approval policy must be one of: never, on-failure, on-request, untrusted",
    );
    expect(output).toContain("6. Sandbox mode: unsafe");
    expect(output).toContain(
      "error: Sandbox mode must be one of: read-only, workspace-write, danger-full-access",
    );
    expect(output).toContain("continue: blocked by working directory, web search, approval policy, sandbox mode");
    expect(output).not.toContain("Permissions step saved. Opening Stop Rules.");
  });

  it("shows inline stop-rule errors and stays on the step when continue is blocked by missing or invalid thresholds", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });
    const io = createCapturingIo();

    await openResearchSessionShell(launch, io, {
      input: { isTTY: true } as NodeJS.ReadableStream,
      output: new CaptureWritable(),
      createReadline: createMockReadline([
        "continue",
        "edit failures",
        "   ",
        "edit progress",
        "0",
        "edit evidence",
        "-1",
        "continue",
        "quit",
      ]),
    });

    const savedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(launch.sessionPath, "utf8")),
    );
    const output = io.stdoutText();

    expect(savedDraft.stopPolicy).toMatchObject({
      repeatedFailures: 3,
      noMeaningfulProgress: 5,
      insufficientEvidence: 3,
    });
    expect(savedDraft.draftState).toMatchObject({
      currentStep: "stopRules",
      completedSteps: ["permissions"],
      flowState: {
        stopRules: {
          repeatedFailures: "   ",
          noMeaningfulProgress: "0",
          insufficientEvidence: "-1",
        },
      },
    });
    expect(output).toContain("Permissions step saved. Opening Stop Rules.");
    expect(output).toContain("Repeated failures threshold error: Repeated failures threshold must be a positive integer");
    expect(output).toContain("No-progress threshold error: No-progress threshold must be a positive integer");
    expect(output).toContain(
      "Insufficient-evidence threshold error: Insufficient-evidence threshold must be a positive integer",
    );
    expect(output).toContain("Stop Rules step has validation errors. Fix them before continuing.");
    expect(output).toContain(
      "Stop Rules: current, pending, invalid (repeated failures threshold, no-progress threshold, insufficient-evidence threshold)",
    );
    expect(output).toContain("1. Repeated failures threshold: <blank>");
    expect(output).toContain("error: Repeated failures threshold must be a positive integer");
    expect(output).toContain("2. No-progress threshold: 0");
    expect(output).toContain("error: No-progress threshold must be a positive integer");
    expect(output).toContain("3. Insufficient-evidence threshold: -1");
    expect(output).toContain("error: Insufficient-evidence threshold must be a positive integer");
    expect(output).toContain(
      "continue: blocked by repeated failures threshold, no-progress threshold, insufficient-evidence threshold",
    );
    expect(output).not.toContain("Stop Rules step saved. Opening Outputs.");
  });

  it("shows inline outputs errors and stays on the step when continue is blocked by invalid output targets", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });
    const io = createCapturingIo();

    await openResearchSessionShell(launch, io, {
      input: { isTTY: true } as NodeJS.ReadableStream,
      output: new CaptureWritable(),
      createReadline: createMockReadline([
        "next",
        "next",
        "edit goal",
        "   ",
        "edit trackable",
        "../reports/**/*.json",
        "edit baseline",
        "   ",
        "edit agent",
        "   ",
        "edit startup",
        "0",
        "edit turn",
        "-1",
        "continue",
        "quit",
      ]),
    });

    const savedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(launch.sessionPath, "utf8")),
    );
    const output = io.stdoutText();

    expect(savedDraft.draftState).toMatchObject({
      currentStep: "outputs",
      completedSteps: ["permissions"],
      flowState: {
        outputs: {
          goal: "   ",
          trackableGlobs: "../reports/**/*.json",
          baseRef: "   ",
          agentCommand: "   ",
          startupTimeoutSec: "0",
          turnTimeoutSec: "-1",
        },
      },
    });
    expect(output).toContain("Step 3/4: Outputs");
    expect(output).toContain("Goal error: Goal is required");
    expect(output).toContain("Trackable files error: Trackable files must stay within the working directory");
    expect(output).toContain("Baseline ref error: Baseline ref is required");
    expect(output).toContain("Agent command error: Agent command is required");
    expect(output).toContain("Startup timeout (sec) error: Agent startup timeout must be a positive integer");
    expect(output).toContain("Turn timeout (sec) error: Agent turn timeout must be a positive integer");
    expect(output).toContain("Outputs step has validation errors. Fix them before continuing.");
    expect(output).toContain(
      "Outputs: current, pending, invalid (goal, trackable files, baseline ref, agent command, startup timeout (sec), turn timeout (sec))",
    );
    expect(output).toContain("1. Goal: <blank>");
    expect(output).toContain("error: Goal is required");
    expect(output).toContain("2. Trackable files: ../reports/**/*.json");
    expect(output).toContain("error: Trackable files must stay within the working directory");
    expect(output).toContain("3. Baseline ref: <blank>");
    expect(output).toContain("error: Baseline ref is required");
    expect(output).toContain("4. Agent command: <blank>");
    expect(output).toContain("error: Agent command is required");
    expect(output).toContain("6. Startup timeout (sec): 0");
    expect(output).toContain("error: Agent startup timeout must be a positive integer");
    expect(output).toContain("7. Turn timeout (sec): -1");
    expect(output).toContain("error: Agent turn timeout must be a positive integer");
    expect(output).toContain(
      "continue: blocked by goal, trackable files, baseline ref, agent command, startup timeout (sec), turn timeout (sec)",
    );
    expect(output).not.toContain("Outputs step saved. Opening Review.");
  });

  it("walks the shell in the fixed permissions -> stop rules -> outputs -> review order", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });
    const io = createCapturingIo();
    const interactiveSessionService = {
      launchFromDraft: vi.fn(async () => ({
        sessionId: "session-20260412-000500",
        lifecyclePath: ".ralph/sessions/session-20260412-000500/codex-session.json",
        started: {
          step: "session_started" as const,
        },
        finalized: {
          step: "session_failed" as const,
        },
      })),
    };

    await openResearchSessionShell(launch, io, {
      input: { isTTY: true } as NodeJS.ReadableStream,
      output: new CaptureWritable(),
      interactiveSessionService,
      createReadline: createMockReadline([
        "continue",
        "edit failures",
        "4",
        "continue",
        "edit goal",
        "improve future holdout top-3 accuracy",
        "edit trackable",
        "**/*.ts, reports/**/*.json",
        "edit baseline",
        "HEAD",
        "edit agent",
        "codex --model gpt-5.4",
        "edit startup",
        "45",
        "edit turn",
        "1200",
        "continue",
        "confirm",
        "submit",
      ]),
    });

    const savedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(launch.sessionPath, "utf8")),
    );
    const output = io.stdoutText();

    expect(savedDraft.goal).toBe("improve future holdout top-3 accuracy");
    expect(savedDraft.stopPolicy.repeatedFailures).toBe(4);
    expect(savedDraft.context.trackableGlobs).toEqual(["**/*.ts", "reports/**/*.json"]);
    expect(savedDraft.draftState).toMatchObject({
      currentStep: "review",
      completedSteps: ["permissions", "stopRules", "outputs", "review"],
      reviewConfirmed: true,
    });
    expect(output).toContain("Permissions step saved. Opening Stop Rules.");
    expect(output).toContain("Step 2/4: Stop Rules");
    expect(output).toContain("Stop Rules step saved. Opening Outputs.");
    expect(output).toContain("Step 3/4: Outputs");
    expect(output).toContain("Outputs step saved. Opening Review.");
    expect(output).toContain("Step 4/4: Review");
    expect(output).toContain("  Permissions");
    expect(output).toContain("  Stop Rules");
    expect(output).toContain("  Outputs");
    expect(output).toContain(`Working directory: ${launch.repoRoot}`);
    expect(output).toContain("Repeated failures threshold: 4");
    expect(output).toContain("Goal: improve future holdout top-3 accuracy");
    expect(output).toContain("Trackable files: **/*.ts, reports/**/*.json");
    expect(output).toContain("Agent command: codex --model gpt-5.4");
    expect(output).toContain("Startup timeout (sec): 45");
    expect(output).toContain("Turn timeout (sec): 1200");
    expect(output).toContain("final confirmation: pending (run confirm to enable submit)");
    expect(output).toContain("Final confirmation recorded. Submit is now available.");
    expect(output).toContain("final confirmation: confirmed");
    expect(output).toContain("Review complete. Starting the interactive Codex session.");
    expect(interactiveSessionService.launchFromDraft).toHaveBeenCalledWith({
      repoRoot: launch.repoRoot,
      draftSessionId: launch.sessionId,
    });
  });

  it("supports bounded adjacent next/back navigation until review, then blocks mutation commands from the read-only summary", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });
    const io = createCapturingIo();
    const interactiveSessionService = {
      launchFromDraft: vi.fn(async () => {
        throw new Error("launchFromDraft should not be called by next/back navigation");
      }),
    };

    await openResearchSessionShell(launch, io, {
      input: { isTTY: true } as NodeJS.ReadableStream,
      output: new CaptureWritable(),
      interactiveSessionService,
      createReadline: createMockReadline([
        "next",
        "next",
        "next",
        "next",
        "back",
        "quit",
      ]),
    });

    const savedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(launch.sessionPath, "utf8")),
    );
    const output = io.stdoutText();

    expect(savedDraft.draftState?.currentStep).toBe("review");
    expect(output).toContain("Opening Step 2/4: Stop Rules.");
    expect(output).toContain("Opening Step 3/4: Outputs.");
    expect(output).toContain("Opening Step 4/4: Review.");
    expect(output).toContain("Review is read-only. Use confirm to enable submit, submit to start the interactive Codex session, or quit to leave the draft unchanged.");
    expect(output).not.toContain("Returning to Step 3/4: Outputs.");
    expect(interactiveSessionService.launchFromDraft).not.toHaveBeenCalled();
  });

  it("keeps submit blocked in review until the operator records the final confirmation control", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });
    const io = createCapturingIo();
    const interactiveSessionService = {
      launchFromDraft: vi.fn(async () => {
        throw new Error("launchFromDraft should stay blocked until confirm");
      }),
    };

    await openResearchSessionShell(launch, io, {
      input: { isTTY: true } as NodeJS.ReadableStream,
      output: new CaptureWritable(),
      interactiveSessionService,
      createReadline: createMockReadline([
        "continue",
        "continue",
        "continue",
        "submit",
        "quit",
      ]),
    });

    const savedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(launch.sessionPath, "utf8")),
    );
    const output = io.stdoutText();

    expect(savedDraft.draftState).toMatchObject({
      currentStep: "review",
      completedSteps: ["permissions", "stopRules", "outputs"],
      reviewConfirmed: false,
    });
    expect(output).toContain("final confirmation: pending (run confirm to enable submit)");
    expect(output).toContain("submit: blocked until final confirmation");
    expect(output).toContain("Review requires final confirmation before submitting.");
    expect(output).not.toContain("Review complete. Starting the interactive Codex session.");
    expect(interactiveSessionService.launchFromDraft).not.toHaveBeenCalled();
  });

  it("keeps the review screen read-only even if the operator types edit commands", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });
    const io = createCapturingIo();

    await openResearchSessionShell(launch, io, {
      input: { isTTY: true } as NodeJS.ReadableStream,
      output: new CaptureWritable(),
      createReadline: createMockReadline([
        "continue",
        "continue",
        "continue",
        "edit stop",
        "quit",
      ]),
    });

    const savedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(launch.sessionPath, "utf8")),
    );
    const output = io.stdoutText();

    expect(savedDraft.draftState?.currentStep).toBe("review");
    expect(output).toContain("Step 4/4: Review");
    expect(output).toContain("Review is read-only. Use confirm to enable submit, submit to start the interactive Codex session, or quit to leave the draft unchanged.");
    expect(output).toContain("Commands: confirm, submit, help, quit");
    expect(output).not.toContain("Review jump: reopening Step 2/4: Stop Rules.");
    expect(output).not.toContain("Stop Rules step saved. Returning to Review.");
  });

  it("keeps the review screen read-only even if the operator types back or next", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });
    const io = createCapturingIo();

    await openResearchSessionShell(launch, io, {
      input: { isTTY: true } as NodeJS.ReadableStream,
      output: new CaptureWritable(),
      createReadline: createMockReadline([
        "continue",
        "continue",
        "continue",
        "back",
        "next",
        "quit",
      ]),
    });

    const savedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(launch.sessionPath, "utf8")),
    );
    const output = io.stdoutText();

    expect(savedDraft.draftState?.currentStep).toBe("review");
    expect(output.match(/Review is read-only\. Use confirm to enable submit, submit to start the interactive Codex session, or quit to leave the draft unchanged\./g)).toHaveLength(2);
    expect(output).not.toContain("Returning to Step 3/4: Outputs.");
    expect(output).not.toContain("Opening Step 4/4: Review.");
  });

  it("offers a safe continue path when launch finds a resumable persisted session", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });
    const io = createCapturingIo();
    const interactiveSessionService = {
      launchFromDraft: vi.fn(async () => {
        throw new Error("launchFromDraft should not be used");
      }),
    };

    const shellResult = await openResearchSessionShell(
      {
        ...launch,
        existingSession: {
          session: researchSessionRecordSchema.parse({
            sessionId: "session-continue-001",
            goal: "persisted research goal",
            workingDirectory: tempRoot,
            status: "halted",
            agent: {
              type: "codex_cli",
              command: "codex",
              approvalPolicy: "never",
              sandboxMode: "workspace-write",
              ttySession: {
                startupTimeoutSec: 30,
                turnTimeoutSec: 900,
              },
            },
            workspace: {
              strategy: "git_worktree",
              promoted: false,
            },
            stopPolicy: {
              repeatedFailures: 3,
              noMeaningfulProgress: 5,
              insufficientEvidence: 3,
            },
            progress: {
              completedCycles: 2,
              nextCycle: 3,
              latestRunId: "run-002",
              latestDecisionId: "decision-002",
              latestFrontierIds: ["frontier-002"],
              repeatedFailureStreak: 3,
              noMeaningfulProgressStreak: 0,
              insufficientEvidenceStreak: 0,
              lastCheckpointAt: "2026-04-12T00:05:00.000Z",
              lastSignals: {
                cycle: 2,
                outcome: "accepted",
                changedFileCount: 2,
                diffLineCount: 12,
                repeatedDiff: false,
                meaningfulProgress: true,
                insufficientEvidence: false,
                agentTieBreakerUsed: false,
                newArtifacts: ["reports/holdout-002.json"],
                reasons: ["Produced the latest holdout bundle."],
              },
            },
            stopCondition: {
              type: "repeated_failures",
              count: 3,
              threshold: 3,
            },
            resume: {
              resumable: true,
              checkpointType: "completed_cycle_boundary",
              resumeFromCycle: 3,
              requiresUserConfirmation: true,
              checkpointRunId: "run-002",
              checkpointDecisionId: "decision-002",
            },
            createdAt: "2026-04-12T00:00:00.000Z",
            updatedAt: "2026-04-12T00:05:00.000Z",
          }),
          lifecycle: {
            sessionId: "session-continue-001",
            workingDirectory: tempRoot,
            goal: "persisted research goal",
            resumeFromCycle: 3,
            completedCycles: 2,
            command: "codex",
            args: ["continue"],
            approvalPolicy: "never",
            sandboxMode: "workspace-write",
            startedAt: "2026-04-12T00:04:00.000Z",
            updatedAt: "2026-04-12T00:05:00.000Z",
            phase: "clean_exit",
            endedAt: "2026-04-12T00:05:00.000Z",
            exit: {
              code: 0,
              signal: null,
            },
          },
          recovery: {
            classification: "resumable" as const,
            resumeAllowed: true,
            reason: "session halted after 3 repeated failures; continue from completed cycle boundary 3",
            runtime: {
              state: "exited" as const,
              processAlive: false,
              stale: false,
              phase: "clean_exit",
            },
          },
        },
      },
      io,
      {
        input: { isTTY: true } as NodeJS.ReadableStream,
        output: new CaptureWritable(),
        interactiveSessionService,
        createReadline: createMockReadline(["resume"]),
      },
    );

    expect(shellResult).toEqual({
      entrySelection: "resume",
      sessionId: "session-continue-001",
    });
    expect(io.stdoutText()).toContain("Existing session found:");
    expect(io.stdoutText()).toContain("Resume or New Session:");
    expect(io.stdoutText()).toContain("resume: continue the resumable session from its last completed cycle boundary");
    expect(io.stdoutText()).toContain("new session: keep the saved draft and start a fresh session review");
    expect(io.stdoutText()).toContain("Commands: resume, inspect, new session, help, quit");
    expect(io.stdoutText()).toContain("recovery: resumable");
  });

  it("renders the selected-candidate summary payload when prompting for resume or new", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });
    const io = createCapturingIo();
    const interactiveSessionService = {
      launchFromDraft: vi.fn(async () => {
        throw new Error("launchFromDraft should not be used");
      }),
    };

    await openResearchSessionShell(
      {
        ...launch,
        selectedCandidateSummary: {
          sessionId: "session-summary-001",
          status: "halted",
          goal: "summary goal from launch payload",
          updatedAt: "2026-04-12T00:12:00.000Z",
          resumeFromCycle: 5,
          checkpoint: {
            completedCycles: 4,
            latestRunId: "run-004",
            latestDecisionId: "decision-004",
            lastCheckpointAt: "2026-04-12T00:11:00.000Z",
            stopCondition: "operator_stop",
          },
          latestCycle: {
            outcome: "accepted",
            meaningfulProgress: true,
            insufficientEvidence: false,
            changedFileCount: 3,
            diffLineCount: 27,
            newArtifactCount: 2,
            agentSummary: "Holdout bundle improved.",
          },
          recovery: {
            classification: "resumable",
            resumeAllowed: true,
            reason: "summary resume recommendation",
            runtimeState: "exited",
            codexPhase: "clean_exit",
          },
          userConfirmation: {
            required: true,
          },
        },
        existingSession: {
          session: researchSessionRecordSchema.parse({
            sessionId: "session-raw-001",
            goal: "raw persisted goal",
            workingDirectory: tempRoot,
            status: "halted",
            agent: {
              type: "codex_cli",
              command: "codex",
              approvalPolicy: "never",
              sandboxMode: "workspace-write",
              ttySession: {
                startupTimeoutSec: 30,
                turnTimeoutSec: 900,
              },
            },
            workspace: {
              strategy: "git_worktree",
              promoted: false,
            },
            stopPolicy: {
              repeatedFailures: 3,
              noMeaningfulProgress: 5,
              insufficientEvidence: 3,
            },
            progress: {
              completedCycles: 1,
              nextCycle: 2,
              latestRunId: "run-001",
              latestDecisionId: "decision-001",
              latestFrontierIds: ["frontier-001"],
              repeatedFailureStreak: 0,
              noMeaningfulProgressStreak: 0,
              insufficientEvidenceStreak: 0,
              lastCheckpointAt: "2026-04-12T00:02:00.000Z",
              lastSignals: {
                cycle: 1,
                outcome: "failed",
                changedFileCount: 1,
                diffLineCount: 4,
                repeatedDiff: false,
                meaningfulProgress: false,
                insufficientEvidence: false,
                agentTieBreakerUsed: false,
                newArtifacts: [],
                reasons: ["Raw inspection fixture."],
              },
            },
            stopCondition: {
              type: "operator_stop",
            },
            resume: {
              resumable: true,
              checkpointType: "completed_cycle_boundary",
              resumeFromCycle: 2,
              requiresUserConfirmation: true,
              checkpointRunId: "run-001",
              checkpointDecisionId: "decision-001",
            },
            createdAt: "2026-04-12T00:00:00.000Z",
            updatedAt: "2026-04-12T00:02:00.000Z",
          }),
          lifecycle: {
            sessionId: "session-raw-001",
            workingDirectory: tempRoot,
            goal: "raw persisted goal",
            resumeFromCycle: 2,
            completedCycles: 1,
            command: "codex",
            args: ["continue"],
            approvalPolicy: "never",
            sandboxMode: "workspace-write",
            startedAt: "2026-04-12T00:01:00.000Z",
            updatedAt: "2026-04-12T00:02:00.000Z",
            phase: "running",
            attachmentState: {
              status: "attached",
            },
          },
          recovery: {
            classification: "inspect_only",
            resumeAllowed: false,
            reason: "raw inspection should not drive the prompt surface",
            runtime: {
              state: "active",
              processAlive: true,
              stale: false,
              phase: "running",
            },
          },
        },
      },
      io,
      {
        input: { isTTY: true } as NodeJS.ReadableStream,
        output: new CaptureWritable(),
        interactiveSessionService,
        createReadline: createMockReadline(["new session", "quit"]),
      },
    );

    const output = io.stdoutText();

    expect(output).toContain(
      "State: existing session detected. Resume candidate session-summary-001 is halted with 4 completed cycles and can continue from cycle 5.",
    );
    expect(output).toContain("session: session-summary-001 (halted)");
    expect(output).toContain("checkpoint: completed=4, next=5");
    expect(output).toContain("goal: summary goal from launch payload");
    expect(output).toContain("stop condition: operator_stop");
    expect(output).toContain("latest cycle: accepted; progress=yes; diff=27; artifacts=2");
    expect(output).toContain("decision: pending (resume or new session required)");
    expect(output).toContain("Resume or New Session:");
    expect(output).toContain("Commands: resume, inspect, new session, help, quit");
    expect(output).toContain("recovery: resumable (summary resume recommendation)");
    expect(output).toContain("codex lifecycle: clean_exit");
    expect(output).not.toContain("State: draft ready. No autonomous research cycle has started.");
    expect(output).not.toContain("session: session-raw-001");
    expect(output).not.toContain("checkpoint: completed=1, next=2");
    expect(output).not.toContain("recovery: inspect_only");
    expect(output).toContain("Starting a fresh draft review.");
  });

  it("returns a resume selection for persisted checkpoints without mutating session state directly", async () => {
    const canonicalTempRoot = await realpath(tempRoot);
    const repository = new JsonFileResearchSessionRepository(join(canonicalTempRoot, ".ralph", "sessions"));
    await repository.saveSession(
      researchSessionRecordSchema.parse({
        sessionId: "session-continue-001",
        goal: "persisted research goal",
        workingDirectory: canonicalTempRoot,
        status: "halted",
        agent: {
          type: "codex_cli",
          command: "codex",
          approvalPolicy: "never",
          sandboxMode: "workspace-write",
          ttySession: {
            startupTimeoutSec: 30,
            turnTimeoutSec: 900,
          },
        },
        context: {
          trackableGlobs: ["reports/**/*.json", "src/**/*.ts"],
          webSearch: true,
          shellCommandAllowlistAdditions: [],
          shellCommandAllowlistRemovals: [],
        },
        workspace: {
          strategy: "git_worktree",
          currentRef: "refs/heads/candidate-002",
          currentPath: join(canonicalTempRoot, ".ralph", "workspaces", "candidate-002"),
          promoted: false,
        },
        stopPolicy: {
          repeatedFailures: 3,
          noMeaningfulProgress: 5,
          insufficientEvidence: 3,
        },
        progress: {
          completedCycles: 2,
          nextCycle: 3,
          latestRunId: "run-002",
          latestDecisionId: "decision-002",
          latestFrontierIds: ["frontier-001", "frontier-002"],
          repeatedFailureStreak: 1,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 2,
          lastCheckpointAt: "2026-04-12T00:05:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 2,
            diffLineCount: 18,
            repeatedDiff: false,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            newArtifacts: ["reports/cycle-002.json"],
            reasons: ["Persisted the cycle 2 checkpoint bundle."],
          },
        },
        stopCondition: {
          type: "operator_stop",
          note: "Operator paused before cycle 3.",
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: true,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          interruptionDetectedAt: "2026-04-12T00:05:30.000Z",
          interruptedDuringCycle: 3,
          note: "Codex CLI exited cleanly before cycle 3 completed.",
        },
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-12T00:05:30.000Z",
      }),
    );

    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:06:00.000Z"),
    });
    const launch = await launchService.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: canonicalTempRoot,
    });
    const io = createCapturingIo();
    const interactiveSessionService = {
      launchFromDraft: async () => {
        throw new Error("launchFromDraft should not be called when resume is selected");
      },
    };

    expect(launch.existingSession?.session.sessionId).toBe("session-continue-001");

    const shellResult = await openResearchSessionShell(launch, io, {
      input: { isTTY: true } as NodeJS.ReadableStream,
      output: new CaptureWritable(),
      interactiveSessionService,
      createReadline: createMockReadline(["resume"]),
    });

    const persistedSession = researchSessionRecordSchema.parse(
      JSON.parse(
        await readFile(
          join(canonicalTempRoot, ".ralph", "sessions", "session-continue-001", "session.json"),
          "utf8",
        ),
      ),
    );
    const persistedSessionIds = (await readdir(join(canonicalTempRoot, ".ralph", "sessions"))).sort();

    expect(shellResult).toEqual({
      entrySelection: "resume",
      sessionId: "session-continue-001",
    });
    expect(persistedSession).toMatchObject({
      sessionId: "session-continue-001",
      status: "halted",
      progress: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-001", "frontier-002"],
      },
      resume: {
        resumable: true,
        resumeFromCycle: 3,
        checkpointRunId: "run-002",
        checkpointDecisionId: "decision-002",
        requiresUserConfirmation: true,
      },
    });
    expect(persistedSessionIds).toEqual(["launch-draft", "session-continue-001"]);
    expect(io.stdoutText()).toContain("Existing session found:");
    expect(io.stdoutText()).toContain("Resume or New Session:");
    expect(io.stdoutText()).toContain("checkpoint: completed=2, next=3");
  });
});

class CaptureWritable extends Writable {
  public readonly isTTY = true;

  public override _write(
    _chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    callback();
  }
}

function createMockReadline(lines: string[]) {
  return () => {
    const queue = [...lines];

    return {
      async question(_prompt: string) {
        const line = queue.shift();
        if (line === undefined) {
          throw new Error("No more readline input");
        }
        return line;
      },
      close() {},
    };
  };
}
