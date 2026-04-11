import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { researchProjectDefaultsRecordSchema } from "../src/core/model/research-project-defaults.js";
import {
  buildResearchSessionMetadata,
  researchSessionRecordSchema,
} from "../src/core/model/research-session.js";
import type { ResearchSessionRecord } from "../src/core/model/research-session.js";
import type { ResearchSessionQuery, ResearchSessionRepository } from "../src/core/ports/research-session-repository.js";
import { ResearchSessionLaunchService } from "../src/app/services/research-session-launch-service.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-launch-service-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("ResearchSessionLaunchService", () => {
  it("trims the goal and resolves the working directory for the v1 launch flow", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const canonicalRoot = await realpath(tempRoot);

    const result = await service.launch({
      goal: "  improve holdout top-3 accuracy  ",
      repoRoot: tempRoot,
    });

    expect(result).toMatchObject({
      goal: "improve holdout top-3 accuracy",
      repoRoot: canonicalRoot,
      interface: "tui",
      status: "draft_created",
      sessionId: "launch-draft",
      sessionPath: join(canonicalRoot, ".ralph", "sessions", "launch-draft", "session.json"),
    });

    const savedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(result.sessionPath, "utf8")),
    );

    expect(savedDraft).toMatchObject({
      sessionId: "launch-draft",
      goal: "improve holdout top-3 accuracy",
      workingDirectory: canonicalRoot,
      status: "draft",
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
        trackableGlobs: ["**/*.md", "**/*.txt", "**/*.py", "**/*.ts", "**/*.tsx"],
        webSearch: true,
        shellCommandAllowlistAdditions: [],
        shellCommandAllowlistRemovals: [],
      },
      draftState: {
        currentStep: "permissions",
        flowState: {
          permissions: {
            workingDirectory: canonicalRoot,
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
            goal: "improve holdout top-3 accuracy",
            trackableGlobs: "**/*.md, **/*.txt, **/*.py, **/*.ts, **/*.tsx",
            baseRef: "main",
            agentCommand: "codex",
            model: "",
            startupTimeoutSec: "30",
            turnTimeoutSec: "900",
          },
        },
        goalStep: {
          goal: "improve holdout top-3 accuracy",
          agentCommand: "codex",
          repeatedFailures: "3",
          noMeaningfulProgress: "5",
          insufficientEvidence: "3",
        },
        contextStep: {
          trackableGlobs: "**/*.md, **/*.txt, **/*.py, **/*.ts, **/*.tsx",
          webSearch: "enabled",
          shellCommandAllowlistAdditions: "",
          shellCommandAllowlistRemovals: "",
        },
        workspaceStep: {
          workingDirectory: canonicalRoot,
          baseRef: "main",
        },
        agentStep: {
          command: "codex",
          model: "",
          approvalPolicy: "never",
          sandboxMode: "workspace-write",
          startupTimeoutSec: "30",
          turnTimeoutSec: "900",
        },
      },
      progress: {
        completedCycles: 0,
        nextCycle: 1,
        latestFrontierIds: [],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 1,
        requiresUserConfirmation: false,
      },
    });
  });

  it("seeds a new launch draft from the dedicated project defaults file", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:05:00.000Z"),
    });
    const canonicalRoot = await realpath(tempRoot);
    const defaultsPath = join(canonicalRoot, ".ralph", "project-defaults.json");
    const customWorkingDirectory = join(canonicalRoot, "reports");

    await mkdir(join(canonicalRoot, ".ralph"), { recursive: true });
    await mkdir(customWorkingDirectory, { recursive: true });
    await writeFile(
      defaultsPath,
      `${JSON.stringify({
        recordType: "research_project_defaults",
        version: 1,
        workingDirectory: customWorkingDirectory,
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
            turnTimeoutSec: 1_200,
          },
        },
        stopPolicy: {
          repeatedFailures: 6,
          noMeaningfulProgress: 8,
          insufficientEvidence: 4,
        },
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-12T00:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    const result = await service.launch({
      goal: "improve holdout top-3 accuracy",
      repoRoot: tempRoot,
    });

    const savedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(result.sessionPath, "utf8")),
    );
    const persistedDefaults = researchProjectDefaultsRecordSchema.parse(
      JSON.parse(await readFile(defaultsPath, "utf8")),
    );

    expect(savedDraft).toMatchObject({
      goal: "improve holdout top-3 accuracy",
      workingDirectory: customWorkingDirectory,
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
          turnTimeoutSec: 1_200,
        },
      },
      stopPolicy: {
        repeatedFailures: 6,
        noMeaningfulProgress: 8,
        insufficientEvidence: 4,
      },
      draftState: {
        flowState: {
          permissions: {
            workingDirectory: customWorkingDirectory,
            webSearch: "disabled",
            shellCommandAllowlistAdditions: "git status, git diff",
            shellCommandAllowlistRemovals: "rm, mv",
            approvalPolicy: "on-request",
            sandboxMode: "read-only",
          },
          stopRules: {
            repeatedFailures: "6",
            noMeaningfulProgress: "8",
            insufficientEvidence: "4",
          },
          outputs: {
            goal: "improve holdout top-3 accuracy",
            trackableGlobs: "reports/**/*.json, src/**/*.ts",
            baseRef: "origin/main",
            agentCommand: "codex --model gpt-5.4",
            model: "gpt-5.4",
            startupTimeoutSec: "45",
            turnTimeoutSec: "1200",
          },
        },
      },
    });
    expect(persistedDefaults).toMatchObject({
      workingDirectory: customWorkingDirectory,
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
          turnTimeoutSec: 1_200,
        },
      },
      stopPolicy: {
        repeatedFailures: 6,
        noMeaningfulProgress: 8,
        insufficientEvidence: 4,
      },
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:05:00.000Z",
    });
  });

  it("refreshes the existing launch draft without clobbering the saved goal-step inputs", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const refreshedService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:05:00.000Z"),
    });
    const canonicalRoot = await realpath(tempRoot);

    const first = await service.launch({
      goal: "first draft goal",
      repoRoot: tempRoot,
    });

    const refreshed = await refreshedService.launch({
      goal: "updated draft goal",
      repoRoot: tempRoot,
    });

    expect(refreshed).toMatchObject({
      status: "draft_refreshed",
      sessionId: first.sessionId,
      sessionPath: first.sessionPath,
      goal: "first draft goal",
    });

    const savedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(refreshed.sessionPath, "utf8")),
    );

    expect(savedDraft).toMatchObject({
      sessionId: "launch-draft",
      goal: "first draft goal",
      workingDirectory: canonicalRoot,
      status: "draft",
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
        trackableGlobs: ["**/*.md", "**/*.txt", "**/*.py", "**/*.ts", "**/*.tsx"],
        webSearch: true,
        shellCommandAllowlistAdditions: [],
        shellCommandAllowlistRemovals: [],
      },
      draftState: {
        currentStep: "permissions",
        flowState: {
          permissions: {
            workingDirectory: canonicalRoot,
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
            goal: "first draft goal",
            trackableGlobs: "**/*.md, **/*.txt, **/*.py, **/*.ts, **/*.tsx",
            baseRef: "main",
            agentCommand: "codex",
            model: "",
            startupTimeoutSec: "30",
            turnTimeoutSec: "900",
          },
        },
        goalStep: {
          goal: "first draft goal",
          agentCommand: "codex",
          repeatedFailures: "3",
          noMeaningfulProgress: "5",
          insufficientEvidence: "3",
        },
        contextStep: {
          trackableGlobs: "**/*.md, **/*.txt, **/*.py, **/*.ts, **/*.tsx",
          webSearch: "enabled",
          shellCommandAllowlistAdditions: "",
          shellCommandAllowlistRemovals: "",
        },
        workspaceStep: {
          workingDirectory: canonicalRoot,
          baseRef: "main",
        },
        agentStep: {
          command: "codex",
          model: "",
          approvalPolicy: "never",
          sandboxMode: "workspace-write",
          startupTimeoutSec: "30",
          turnTimeoutSec: "900",
        },
      },
      progress: {
        completedCycles: 0,
        nextCycle: 1,
        latestFrontierIds: [],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
      },
    });
    expect(savedDraft.createdAt).toBe("2026-04-12T00:00:00.000Z");
    expect(savedDraft.updatedAt).toBe("2026-04-12T00:05:00.000Z");
  });

  it("rehydrates a persisted partial agent draft on relaunch without dropping saved inputs", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:05:00.000Z"),
    });
    const canonicalRoot = await realpath(tempRoot);
    const sessionPath = join(canonicalRoot, ".ralph", "sessions", "launch-draft", "session.json");

    await mkdir(join(canonicalRoot, ".ralph", "sessions", "launch-draft"), { recursive: true });
    await writeFile(
      sessionPath,
      `${JSON.stringify({
        sessionId: "launch-draft",
        goal: "persisted top-level goal",
        workingDirectory: canonicalRoot,
        status: "draft",
        agent: {
          type: "codex_cli",
          command: "codex --model gpt-5.4",
          approvalPolicy: "on-request",
          sandboxMode: "danger-full-access",
          ttySession: {
            startupTimeoutSec: 45,
            turnTimeoutSec: 1200,
          },
        },
        workspace: {
          strategy: "git_worktree",
          promoted: false,
        },
        stopPolicy: {
          repeatedFailures: 4,
          noMeaningfulProgress: 6,
          insufficientEvidence: 2,
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
        draftState: {
          currentStep: "outputs",
          agentStep: {
            command: "   ",
            sandboxMode: "unsafe",
          },
        },
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-12T00:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    const result = await service.launch({
      goal: "ignored on relaunch",
      repoRoot: tempRoot,
    });

    expect(result).toMatchObject({
      status: "draft_refreshed",
      goal: "persisted top-level goal",
      sessionId: "launch-draft",
      sessionPath,
    });

    const savedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(result.sessionPath, "utf8")),
    );

    expect(savedDraft.draftState).toMatchObject({
      currentStep: "outputs",
      flowState: {
        outputs: {
          agentCommand: "   ",
        },
      },
      goalStep: {
        goal: "persisted top-level goal",
        agentCommand: "   ",
        repeatedFailures: "4",
        noMeaningfulProgress: "6",
        insufficientEvidence: "2",
      },
      workspaceStep: {
        workingDirectory: canonicalRoot,
        baseRef: "main",
      },
      contextStep: {
        trackableGlobs: "**/*.md, **/*.txt, **/*.py, **/*.ts, **/*.tsx",
        webSearch: "enabled",
        shellCommandAllowlistAdditions: "",
        shellCommandAllowlistRemovals: "",
      },
      agentStep: {
        command: "   ",
        model: "",
        approvalPolicy: "on-request",
        sandboxMode: "unsafe",
        startupTimeoutSec: "45",
        turnTimeoutSec: "1200",
      },
    });
    expect(savedDraft.updatedAt).toBe("2026-04-12T00:05:00.000Z");
  });

  it("prefers the current draft output agent command over the stale persisted agent command on relaunch", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:05:00.000Z"),
    });
    const canonicalRoot = await realpath(tempRoot);
    const sessionPath = join(canonicalRoot, ".ralph", "sessions", "launch-draft", "session.json");

    await mkdir(join(canonicalRoot, ".ralph", "sessions", "launch-draft"), { recursive: true });
    await writeFile(
      sessionPath,
      `${JSON.stringify({
        sessionId: "launch-draft",
        goal: "persisted top-level goal",
        workingDirectory: canonicalRoot,
        status: "draft",
        agent: {
          type: "codex_cli",
          command: "codex --model gpt-5.4",
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
        draftState: {
          currentStep: "outputs",
          agentStep: {
            command: "codex --model gpt-5.4-mini --full-auto",
            model: "gpt-5.4-mini",
          },
        },
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-12T00:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    const result = await service.launch({
      goal: "ignored on relaunch",
      repoRoot: tempRoot,
    });

    const savedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(result.sessionPath, "utf8")),
    );

    expect(savedDraft.draftState).toMatchObject({
      currentStep: "outputs",
      flowState: {
        outputs: {
          agentCommand: "codex --model gpt-5.4-mini --full-auto",
          model: "gpt-5.4-mini",
        },
      },
      goalStep: {
        agentCommand: "codex --model gpt-5.4-mini --full-auto",
      },
      agentStep: {
        command: "codex --model gpt-5.4-mini --full-auto",
        model: "gpt-5.4-mini",
      },
    });
  });

  it("rehydrates a persisted partial context draft on relaunch without dropping saved inputs", async () => {
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:05:00.000Z"),
    });
    const canonicalRoot = await realpath(tempRoot);
    const sessionPath = join(canonicalRoot, ".ralph", "sessions", "launch-draft", "session.json");

    await mkdir(join(canonicalRoot, ".ralph", "sessions", "launch-draft"), { recursive: true });
    await writeFile(
      sessionPath,
      `${JSON.stringify({
        sessionId: "launch-draft",
        goal: "persisted top-level goal",
        workingDirectory: canonicalRoot,
        status: "draft",
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
          trackableGlobs: ["**/*.md", "**/*.txt"],
          webSearch: true,
          shellCommandAllowlistAdditions: ["git status"],
          shellCommandAllowlistRemovals: [],
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
        draftState: {
          currentStep: "permissions",
          contextStep: {
            trackableGlobs: "   ",
            webSearch: "sometimes",
            shellCommandAllowlistAdditions: "git status, git diff",
            shellCommandAllowlistRemovals: "rm, git reset --hard",
          },
        },
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-12T00:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    const result = await service.launch({
      goal: "ignored on relaunch",
      repoRoot: tempRoot,
    });

    expect(result).toMatchObject({
      status: "draft_refreshed",
      goal: "persisted top-level goal",
      sessionId: "launch-draft",
      sessionPath,
    });

    const savedDraft = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(result.sessionPath, "utf8")),
    );

    expect(savedDraft.context).toMatchObject({
      trackableGlobs: ["**/*.md", "**/*.txt"],
      webSearch: true,
      shellCommandAllowlistAdditions: ["git status"],
      shellCommandAllowlistRemovals: [],
    });
    expect(savedDraft.draftState).toMatchObject({
      currentStep: "permissions",
      goalStep: {
        goal: "persisted top-level goal",
        agentCommand: "codex",
        repeatedFailures: "3",
        noMeaningfulProgress: "5",
        insufficientEvidence: "3",
      },
      workspaceStep: {
        workingDirectory: canonicalRoot,
        baseRef: "main",
      },
      contextStep: {
        trackableGlobs: "   ",
        webSearch: "sometimes",
        shellCommandAllowlistAdditions: "git status, git diff",
        shellCommandAllowlistRemovals: "rm, git reset --hard",
      },
      agentStep: {
        command: "codex",
        model: "",
        approvalPolicy: "never",
        sandboxMode: "workspace-write",
        startupTimeoutSec: "30",
        turnTimeoutSec: "900",
      },
    });
    expect(savedDraft.updatedAt).toBe("2026-04-12T00:05:00.000Z");
  });

  it("rejects an empty goal before launch starts", async () => {
    const service = new ResearchSessionLaunchService();

    await expect(
      service.launch({
        goal: "   ",
        repoRoot: tempRoot,
      }),
    ).rejects.toThrow("Goal is required");
  });

  it("rejects a working directory that is not a directory", async () => {
    const service = new ResearchSessionLaunchService();
    const filePath = join(tempRoot, "not-a-directory.txt");
    await writeFile(filePath, "fixture\n", "utf8");

    await expect(
      service.launch({
        goal: "improve holdout top-3 accuracy",
        repoRoot: filePath,
      }),
    ).rejects.toThrow(`Working directory is not a directory: ${filePath}`);
  });

  it("surfaces the latest persisted session inspection to callers for safe continue decisions", async () => {
    const canonicalRoot = await realpath(tempRoot);
    const observedQueries: ResearchSessionQuery[] = [];
    const latestSession = researchSessionRecordSchema.parse({
      sessionId: "session-continue",
      goal: "persisted research session goal",
      workingDirectory: canonicalRoot,
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
        lastCheckpointAt: "2026-04-12T00:10:00.000Z",
        lastSignals: {
          cycle: 2,
          outcome: "failed",
          changedFileCount: 1,
          diffLineCount: 12,
          meaningfulProgress: false,
          reasons: ["Cycle 2 ended in repeated failure."],
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
      updatedAt: "2026-04-12T00:10:00.000Z",
    });
    const repository: ResearchSessionRepository = {
      async saveSession(_record) {},
      async loadSession(sessionId) {
        return sessionId === "launch-draft" ? null : latestSession;
      },
      async querySessions(query = {}) {
        observedQueries.push(query);
        return [latestSession];
      },
    };
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:15:00.000Z"),
      createRepository: () => repository,
      recoveryService: {
        inspectSession: async () => ({
          session: latestSession,
          lifecycle: {
            sessionId: latestSession.sessionId,
            workingDirectory: canonicalRoot,
            goal: latestSession.goal,
            resumeFromCycle: 3,
            completedCycles: 2,
            command: "codex",
            args: ["-C", canonicalRoot],
            approvalPolicy: "never",
            sandboxMode: "workspace-write",
            startedAt: "2026-04-12T00:09:00.000Z",
            updatedAt: "2026-04-12T00:10:00.000Z",
            phase: "clean_exit",
            endedAt: "2026-04-12T00:10:00.000Z",
            exit: {
              code: 0,
              signal: null,
            },
          },
          recovery: {
            classification: "resumable",
            resumeAllowed: true,
            reason: "session halted after 3 repeated failures; continue from completed cycle boundary 3",
            runtime: {
              state: "exited",
              processAlive: false,
              stale: false,
              phase: "clean_exit",
            },
          },
          codexSessionReference: {
            codexSessionId: "codex-session-continue",
            lifecyclePath: join(canonicalRoot, ".ralph", "sessions", "session-continue", "codex-session.json"),
          },
        }),
      },
    });

    const result = await service.launch({
      goal: "new draft goal",
      repoRoot: tempRoot,
    });

    expect(result.existingSession).toMatchObject({
      session: {
        sessionId: "session-continue",
        status: "halted",
      },
      lifecycle: {
        phase: "clean_exit",
      },
      recovery: {
        classification: "resumable",
        resumeAllowed: true,
      },
    });
    expect(result.resumableSession).toEqual({
      sessionId: "session-continue",
      persistedState: {
        session: latestSession,
        lifecycle: {
          sessionId: latestSession.sessionId,
          workingDirectory: canonicalRoot,
          goal: latestSession.goal,
          resumeFromCycle: 3,
          completedCycles: 2,
          command: "codex",
          args: ["-C", canonicalRoot],
          approvalPolicy: "never",
          sandboxMode: "workspace-write",
          startedAt: "2026-04-12T00:09:00.000Z",
          updatedAt: "2026-04-12T00:10:00.000Z",
          phase: "clean_exit",
          endedAt: "2026-04-12T00:10:00.000Z",
          exit: {
            code: 0,
            signal: null,
          },
        },
        codexSessionReference: {
          codexSessionId: "codex-session-continue",
          lifecyclePath: join(canonicalRoot, ".ralph", "sessions", "session-continue", "codex-session.json"),
        },
      },
    });
    expect(result.selectedCandidateSummary).toEqual({
      sessionId: "session-continue",
      status: "halted",
      goal: "persisted research session goal",
      updatedAt: "2026-04-12T00:10:00.000Z",
      resumeFromCycle: 3,
      checkpoint: {
        completedCycles: 2,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        lastCheckpointAt: "2026-04-12T00:10:00.000Z",
        stopCondition: "repeated_failures",
      },
      latestCycle: {
        outcome: "failed",
        meaningfulProgress: false,
        insufficientEvidence: false,
        changedFileCount: 1,
        diffLineCount: 12,
        newArtifactCount: 0,
      },
      recovery: {
        classification: "resumable",
        resumeAllowed: true,
        reason: "session halted after 3 repeated failures; continue from completed cycle boundary 3",
        runtimeState: "exited",
        codexPhase: "clean_exit",
      },
      userConfirmation: {
        required: true,
      },
    });
    expect(observedQueries).toEqual([
      {
        workingDirectory: canonicalRoot,
        statuses: ["running", "halted"],
      },
    ]);
  });

  it("selects the deterministic resume candidate before loading recovery evidence", async () => {
    const canonicalRoot = await realpath(tempRoot);
    const runningNewerSession = researchSessionRecordSchema.parse({
      sessionId: "session-running-newer",
      goal: "improve the holdout top-3 model",
      workingDirectory: canonicalRoot,
      status: "running",
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
        completedCycles: 5,
        nextCycle: 6,
        latestRunId: "run-005",
        latestDecisionId: "decision-005",
        latestFrontierIds: ["frontier-005"],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
        lastCheckpointAt: "2026-04-12T00:12:00.000Z",
        lastSignals: {
          cycle: 5,
          outcome: "accepted",
          changedFileCount: 2,
          diffLineCount: 18,
          meaningfulProgress: true,
          insufficientEvidence: false,
          agentTieBreakerUsed: false,
          repeatedDiff: false,
          newArtifacts: ["reports/cycle-005.json"],
          reasons: ["Checkpoint 5 persisted before the next cycle."],
        },
      },
      stopCondition: {
        type: "none",
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 6,
        requiresUserConfirmation: false,
        checkpointRunId: "run-005",
        checkpointDecisionId: "decision-005",
      },
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:12:30.000Z",
    });
    const haltedResumeCandidate = researchSessionRecordSchema.parse({
      sessionId: "session-halted-resume",
      goal: "improve the holdout top-3 model",
      workingDirectory: canonicalRoot,
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
        completedCycles: 4,
        nextCycle: 5,
        latestRunId: "run-004",
        latestDecisionId: "decision-004",
        latestFrontierIds: ["frontier-004"],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
        lastCheckpointAt: "2026-04-12T00:11:00.000Z",
        lastSignals: {
          cycle: 4,
          outcome: "accepted",
          changedFileCount: 1,
          diffLineCount: 11,
          meaningfulProgress: true,
          insufficientEvidence: false,
          agentTieBreakerUsed: false,
          repeatedDiff: false,
          newArtifacts: ["reports/cycle-004.json"],
          reasons: ["Checkpoint 4 persisted for the halted session."],
        },
      },
      stopCondition: {
        type: "operator_stop",
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 5,
        requiresUserConfirmation: true,
        checkpointRunId: "run-004",
        checkpointDecisionId: "decision-004",
      },
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:11:30.000Z",
    });
    const otherGoalSession = researchSessionRecordSchema.parse({
      sessionId: "session-other-goal",
      goal: "ship the MCP transport",
      workingDirectory: canonicalRoot,
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
        completedCycles: 8,
        nextCycle: 9,
        latestRunId: "run-008",
        latestDecisionId: "decision-008",
        latestFrontierIds: ["frontier-008"],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
        lastCheckpointAt: "2026-04-12T00:13:00.000Z",
        lastSignals: {
          cycle: 8,
          outcome: "accepted",
          changedFileCount: 3,
          diffLineCount: 24,
          meaningfulProgress: true,
          insufficientEvidence: false,
          agentTieBreakerUsed: false,
          repeatedDiff: false,
          newArtifacts: ["reports/cycle-008.json"],
          reasons: ["Other goal checkpoint 8 persisted."],
        },
      },
      stopCondition: {
        type: "operator_stop",
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 9,
        requiresUserConfirmation: true,
        checkpointRunId: "run-008",
        checkpointDecisionId: "decision-008",
      },
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:13:30.000Z",
    });

    const inspectedSessionIds: string[] = [];
    const repository: ResearchSessionRepository = {
      async saveSession(_record) {},
      async loadSession(sessionId) {
        return sessionId === "launch-draft" ? null : null;
      },
      async querySessions(query = {}) {
        expect(query).toEqual({
          workingDirectory: canonicalRoot,
          statuses: ["running", "halted"],
        });

        return [
          runningNewerSession,
          haltedResumeCandidate,
          otherGoalSession,
        ];
      },
    };
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:15:00.000Z"),
      createRepository: () => repository,
      recoveryService: {
        inspectSession: async ({ sessionId }) => {
          inspectedSessionIds.push(sessionId);
          expect(sessionId).toBe("session-halted-resume");
          return {
            session: haltedResumeCandidate,
            lifecycle: null,
            recovery: {
              classification: "resumable",
              resumeAllowed: true,
              reason: "halted after checkpoint 4",
              runtime: {
                state: "missing",
                processAlive: false,
                stale: false,
              },
            },
          };
        },
      },
    });

    const result = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });

    expect(inspectedSessionIds).toEqual(["session-halted-resume"]);
    expect(result.existingSession?.session.sessionId).toBe("session-halted-resume");
    expect(result.selectedCandidateSummary).toEqual({
      sessionId: "session-halted-resume",
      status: "halted",
      goal: "improve the holdout top-3 model",
      updatedAt: "2026-04-12T00:11:30.000Z",
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
        changedFileCount: 1,
        diffLineCount: 11,
        newArtifactCount: 1,
      },
      recovery: {
        classification: "resumable",
        resumeAllowed: true,
        reason: "halted after checkpoint 4",
        runtimeState: "missing",
      },
      userConfirmation: {
        required: true,
      },
    });
  });

  it("selects the startup resume candidate from persisted session metadata before loading the full inspection bundle", async () => {
    const canonicalRoot = await realpath(tempRoot);
    const haltedResumeCandidate = researchSessionRecordSchema.parse({
      sessionId: "session-halted-metadata",
      goal: "improve the holdout top-3 model",
      workingDirectory: canonicalRoot,
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
        completedCycles: 4,
        nextCycle: 5,
        latestRunId: "run-004",
        latestDecisionId: "decision-004",
        latestFrontierIds: ["frontier-004"],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
        lastCheckpointAt: "2026-04-12T00:11:00.000Z",
        lastSignals: {
          cycle: 4,
          outcome: "accepted",
          changedFileCount: 1,
          diffLineCount: 11,
          meaningfulProgress: true,
          insufficientEvidence: false,
          agentTieBreakerUsed: false,
          repeatedDiff: false,
          newArtifacts: ["reports/cycle-004.json"],
          reasons: ["Checkpoint 4 persisted for startup metadata selection."],
        },
      },
      stopCondition: {
        type: "operator_stop",
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 5,
        requiresUserConfirmation: true,
        checkpointRunId: "run-004",
        checkpointDecisionId: "decision-004",
      },
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:11:30.000Z",
    });
    const inspectedSessionIds: string[] = [];
    const repository: ResearchSessionRepository = {
      async saveSession(_record) {},
      async loadSession(sessionId) {
        return sessionId === "launch-draft" ? null : null;
      },
      async loadSessionMetadata(sessionId) {
        return sessionId === "launch-draft" ? null : null;
      },
      async querySessionMetadata(query = {}) {
        expect(query).toEqual({
          workingDirectory: canonicalRoot,
          statuses: ["running", "halted"],
        });

        return [buildResearchSessionMetadata(haltedResumeCandidate)];
      },
      async querySessions() {
        throw new Error("launch startup should not need full session queries when metadata is available");
      },
    };
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:15:00.000Z"),
      createRepository: () => repository,
      recoveryService: {
        inspectSession: async ({ sessionId }) => {
          inspectedSessionIds.push(sessionId);
          return {
            session: haltedResumeCandidate,
            lifecycle: null,
            recovery: {
              classification: "resumable",
              resumeAllowed: true,
              reason: "halted after checkpoint 4",
              runtime: {
                state: "missing",
                processAlive: false,
                stale: false,
              },
            },
          };
        },
      },
    });

    const result = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });

    expect(inspectedSessionIds).toEqual(["session-halted-metadata"]);
    expect(result.existingSession?.session.sessionId).toBe("session-halted-metadata");
    expect(result.selectedCandidateSummary?.resumeFromCycle).toBe(5);
  });

  it("surfaces non-resumable recovery metadata in the selected-candidate summary payload", async () => {
    const canonicalRoot = await realpath(tempRoot);
    const blockedSession = researchSessionRecordSchema.parse({
      sessionId: "session-non-resumable",
      goal: "improve the holdout top-3 model",
      workingDirectory: canonicalRoot,
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
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
        lastCheckpointAt: "2026-04-12T00:06:00.000Z",
        lastSignals: {
          cycle: 2,
          outcome: "failed",
          changedFileCount: 1,
          diffLineCount: 9,
          meaningfulProgress: false,
          insufficientEvidence: false,
          agentTieBreakerUsed: false,
          repeatedDiff: false,
          newArtifacts: [],
          reasons: ["Checkpoint 2 completed before the unsafe resume state was detected."],
        },
      },
      stopCondition: {
        type: "operator_stop",
        note: "Waiting for operator guidance.",
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
      updatedAt: "2026-04-12T00:06:30.000Z",
    });
    const repository = new ResearchSessionRepositoryDouble([blockedSession]);
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:07:00.000Z"),
      createRepository: () => repository,
      recoveryService: {
        inspectSession: async ({ sessionId }) => {
          expect(sessionId).toBe("session-non-resumable");
          return {
            session: blockedSession,
            lifecycle: {
              sessionId: "session-non-resumable",
              workingDirectory: canonicalRoot,
              goal: "improve the holdout top-3 model",
              resumeFromCycle: 3,
              completedCycles: 2,
              command: "codex",
              args: ["resume"],
              approvalPolicy: "never",
              sandboxMode: "workspace-write",
              startedAt: "2026-04-12T00:01:00.000Z",
              updatedAt: "2026-04-12T00:06:30.000Z",
              phase: "running",
              attachmentState: {
                status: "attached",
              },
            },
            recovery: {
              classification: "non_recoverable",
              resumeAllowed: false,
              reason: "live Codex process is attached to a mismatched worktree checkpoint",
              runtime: {
                state: "active",
                processAlive: true,
                stale: false,
                phase: "running",
              },
            },
          };
        },
      },
    });

    const result = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });

    expect(result.resumableSession).toBeUndefined();
    expect(result.selectedCandidateSummary).toEqual({
      sessionId: "session-non-resumable",
      status: "halted",
      goal: "improve the holdout top-3 model",
      updatedAt: "2026-04-12T00:06:30.000Z",
      resumeFromCycle: 3,
      checkpoint: {
        completedCycles: 2,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        lastCheckpointAt: "2026-04-12T00:06:00.000Z",
        stopCondition: "operator_stop",
      },
      latestCycle: {
        outcome: "failed",
        meaningfulProgress: false,
        insufficientEvidence: false,
        changedFileCount: 1,
        diffLineCount: 9,
        newArtifactCount: 0,
      },
      recovery: {
        classification: "non_recoverable",
        resumeAllowed: false,
        reason: "live Codex process is attached to a mismatched worktree checkpoint",
        runtimeState: "active",
        codexPhase: "running",
      },
      userConfirmation: {
        required: true,
      },
    });
  });

  it("requires explicit user confirmation in the selected-candidate summary even for running resumable sessions", async () => {
    const canonicalRoot = await realpath(tempRoot);
    const runningSession = researchSessionRecordSchema.parse({
      sessionId: "session-running-confirmation",
      goal: "improve the holdout top-3 model",
      workingDirectory: canonicalRoot,
      status: "running",
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
        completedCycles: 3,
        nextCycle: 4,
        latestRunId: "run-003",
        latestDecisionId: "decision-003",
        latestFrontierIds: ["frontier-003"],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
        lastCheckpointAt: "2026-04-12T00:08:00.000Z",
        lastSignals: {
          cycle: 3,
          outcome: "accepted",
          changedFileCount: 4,
          diffLineCount: 35,
          meaningfulProgress: true,
          insufficientEvidence: false,
          agentTieBreakerUsed: false,
          repeatedDiff: false,
          newArtifacts: ["reports/holdout-003.json", "reports/summary-003.md"],
          agentSummary: "Holdout verification improved after the latest checkpoint.",
          reasons: ["Checkpoint 3 persisted before the next research turn."],
        },
      },
      stopCondition: {
        type: "none",
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 4,
        requiresUserConfirmation: false,
        checkpointRunId: "run-003",
        checkpointDecisionId: "decision-003",
      },
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:08:30.000Z",
    });
    const repository = new ResearchSessionRepositoryDouble([runningSession]);
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:09:00.000Z"),
      createRepository: () => repository,
      recoveryService: {
        inspectSession: async ({ sessionId }) => {
          expect(sessionId).toBe("session-running-confirmation");
          return {
            session: runningSession,
            lifecycle: {
              sessionId: "session-running-confirmation",
              workingDirectory: canonicalRoot,
              goal: "improve the holdout top-3 model",
              resumeFromCycle: 4,
              completedCycles: 3,
              command: "codex",
              args: ["continue"],
              approvalPolicy: "never",
              sandboxMode: "workspace-write",
              startedAt: "2026-04-12T00:01:00.000Z",
              updatedAt: "2026-04-12T00:08:30.000Z",
              phase: "running",
              attachmentState: {
                status: "attached",
              },
            },
            recovery: {
              classification: "resumable",
              resumeAllowed: true,
              reason: "running Codex lifecycle can continue from checkpoint 3",
              runtime: {
                state: "active",
                processAlive: true,
                stale: false,
                phase: "running",
              },
            },
          };
        },
      },
    });

    const result = await service.launch({
      goal: "improve the holdout top-3 model",
      repoRoot: tempRoot,
    });

    expect(result.existingSession?.session.resume.requiresUserConfirmation).toBe(false);
    expect(result.selectedCandidateSummary).toEqual({
      sessionId: "session-running-confirmation",
      status: "running",
      goal: "improve the holdout top-3 model",
      updatedAt: "2026-04-12T00:08:30.000Z",
      resumeFromCycle: 4,
      checkpoint: {
        completedCycles: 3,
        latestRunId: "run-003",
        latestDecisionId: "decision-003",
        lastCheckpointAt: "2026-04-12T00:08:00.000Z",
        stopCondition: "none",
      },
      latestCycle: {
        outcome: "accepted",
        meaningfulProgress: true,
        insufficientEvidence: false,
        changedFileCount: 4,
        diffLineCount: 35,
        newArtifactCount: 2,
        agentSummary: "Holdout verification improved after the latest checkpoint.",
      },
      recovery: {
        classification: "resumable",
        resumeAllowed: true,
        reason: "running Codex lifecycle can continue from checkpoint 3",
        runtimeState: "active",
        codexPhase: "running",
      },
      userConfirmation: {
        required: true,
      },
    });
  });

  it("ignores awaiting_resume and other-workspace sessions when discovering prior sessions for launch", async () => {
    const canonicalRoot = await realpath(tempRoot);
    const repository = new ResearchSessionRepositoryDouble([
      researchSessionRecordSchema.parse({
        sessionId: "session-awaiting-resume",
        goal: "stale interrupted session",
        workingDirectory: canonicalRoot,
        status: "awaiting_resume",
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
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastCheckpointAt: "2026-04-12T00:09:00.000Z",
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 1,
            diffLineCount: 7,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["Saved the last completed checkpoint before interruption."],
            newArtifacts: ["reports/cycle-002.json"],
            repeatedDiff: false,
          },
        },
        stopCondition: {
          type: "operator_stop",
          note: "awaiting manual resume",
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: true,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          interruptionDetectedAt: "2026-04-12T00:09:00.000Z",
          interruptedDuringCycle: 3,
        },
        createdAt: "2026-04-12T00:08:00.000Z",
        updatedAt: "2026-04-12T00:09:00.000Z",
      }),
      researchSessionRecordSchema.parse({
        sessionId: "session-other-workspace",
        goal: "other repo session",
        workingDirectory: join(canonicalRoot, "nested-other-workspace"),
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
          completedCycles: 4,
          nextCycle: 5,
          latestRunId: "run-004",
          latestDecisionId: "decision-004",
          latestFrontierIds: ["frontier-004"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 5,
          insufficientEvidenceStreak: 0,
          lastCheckpointAt: "2026-04-12T00:10:00.000Z",
          lastSignals: {
            cycle: 4,
            outcome: "failed",
            changedFileCount: 0,
            diffLineCount: 0,
            meaningfulProgress: false,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["The other workspace stalled."],
            newArtifacts: [],
            repeatedDiff: true,
          },
        },
        stopCondition: {
          type: "no_meaningful_progress",
          count: 5,
          threshold: 5,
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 5,
          requiresUserConfirmation: true,
          checkpointRunId: "run-004",
          checkpointDecisionId: "decision-004",
        },
        createdAt: "2026-04-12T00:06:00.000Z",
        updatedAt: "2026-04-12T00:10:00.000Z",
      }),
    ]);
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:15:00.000Z"),
      createRepository: () => repository,
      recoveryService: {
        inspectSession: async () => {
          throw new Error("inspectSession should not be called when no running or halted session exists");
        },
      },
    });

    const result = await service.launch({
      goal: "new draft goal",
      repoRoot: tempRoot,
    });

    expect(result.existingSession).toBeUndefined();
    expect(repository.observedQueries).toEqual([
      {
        workingDirectory: canonicalRoot,
        statuses: ["running", "halted"],
      },
    ]);
  });

  it("depends only on the research session repository interface for launch storage", async () => {
    const savedRecords: ResearchSessionRecord[] = [];
    const repositoryCalls: Array<{ method: "loadSession" | "saveSession"; payload: string }> = [];
    const repository: ResearchSessionRepository = {
      async saveSession(record) {
        repositoryCalls.push({ method: "saveSession", payload: record.sessionId });
        savedRecords.push(record);
      },
      async loadSession(sessionId) {
        repositoryCalls.push({ method: "loadSession", payload: sessionId });
        return null;
      },
      async querySessions(_query?: ResearchSessionQuery) {
        repositoryCalls.push({ method: "querySessions", payload: "" });
        return [];
      },
    };
    let createdSessionsRoot = "";
    const service = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
      createRepository: (sessionsRoot) => {
        createdSessionsRoot = sessionsRoot;
        return repository;
      },
    });
    const canonicalRoot = await realpath(tempRoot);

    const result = await service.launch({
      goal: "improve holdout top-3 accuracy",
      repoRoot: tempRoot,
    });

    expect(createdSessionsRoot).toBe(join(canonicalRoot, ".ralph", "sessions"));
    expect(repositoryCalls).toEqual([
      { method: "loadSession", payload: "launch-draft" },
      { method: "saveSession", payload: "launch-draft" },
      { method: "querySessions", payload: "" },
    ]);
    expect(savedRecords).toHaveLength(1);
    expect(researchSessionRecordSchema.parse(savedRecords[0])).toMatchObject({
      sessionId: "launch-draft",
      goal: "improve holdout top-3 accuracy",
      workingDirectory: canonicalRoot,
      status: "draft",
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
        trackableGlobs: ["**/*.md", "**/*.txt", "**/*.py", "**/*.ts", "**/*.tsx"],
        webSearch: true,
        shellCommandAllowlistAdditions: [],
        shellCommandAllowlistRemovals: [],
      },
      draftState: {
        currentStep: "permissions",
        goalStep: {
          goal: "improve holdout top-3 accuracy",
          agentCommand: "codex",
          repeatedFailures: "3",
          noMeaningfulProgress: "5",
          insufficientEvidence: "3",
        },
        contextStep: {
          trackableGlobs: "**/*.md, **/*.txt, **/*.py, **/*.ts, **/*.tsx",
          webSearch: "enabled",
          shellCommandAllowlistAdditions: "",
          shellCommandAllowlistRemovals: "",
        },
        workspaceStep: {
          workingDirectory: canonicalRoot,
          baseRef: "main",
        },
        agentStep: {
          command: "codex",
          model: "",
          approvalPolicy: "never",
          sandboxMode: "workspace-write",
          startupTimeoutSec: "30",
          turnTimeoutSec: "900",
        },
      },
    });
    expect(result).toMatchObject({
      sessionId: "launch-draft",
      interface: "tui",
      status: "draft_created",
    });
  });
});

class ResearchSessionRepositoryDouble implements ResearchSessionRepository {
  public readonly observedQueries: ResearchSessionQuery[] = [];

  public constructor(private readonly sessions: readonly ResearchSessionRecord[]) {}

  public async saveSession(_record: ResearchSessionRecord): Promise<void> {}

  public async loadSession(sessionId: string): Promise<ResearchSessionRecord | null> {
    return this.sessions.find((session) => session.sessionId === sessionId) ?? null;
  }

  public async querySessions(query: ResearchSessionQuery = {}): Promise<ResearchSessionRecord[]> {
    this.observedQueries.push(query);

    return this.sessions.filter((session) => {
      if (query.workingDirectory && session.workingDirectory !== query.workingDirectory) {
        return false;
      }

      if (query.statuses && !query.statuses.includes(session.status)) {
        return false;
      }

      return true;
    });
  }
}
