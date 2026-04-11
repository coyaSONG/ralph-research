import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonFileRunStore } from "../src/adapters/fs/json-file-run-store.js";
import type { ResearchSessionOrchestratorStepResult } from "../src/app/services/research-session-orchestrator-service.js";
import { GitWorktreeWorkspaceManager } from "../src/core/engine/workspace-manager.js";
import type { RunRecord } from "../src/core/model/run-record.js";
import { createRalphResearchMcpServer } from "../src/mcp/server.js";
import { initNumericFixtureRepo } from "./helpers/fixture-repo.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-mcp-server-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("MCP server recovery parity", () => {
  it("maps start_session draft ids to the research session orchestrator and returns a transport-safe payload", async () => {
    const repoRoot = join(tempRoot, "repo-session");
    await mkdir(repoRoot, { recursive: true });
    const startSessionCalls: Array<{ repoRoot: string; draftSessionId: string }> = [];
    const orchestratorResult: ResearchSessionOrchestratorStepResult = {
      step: "session_started",
      session: {
        sessionId: "session-20260412-000500",
        goal: "improve future holdout top-3 accuracy",
        workingDirectory: repoRoot,
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
        context: {
          trackableGlobs: ["**/*.ts"],
          webSearch: true,
          shellCommandAllowlistAdditions: [],
          shellCommandAllowlistRemovals: [],
        },
        workspace: {
          strategy: "git_worktree",
          baseRef: "main",
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
        createdAt: "2026-04-12T00:05:00.000Z",
        updatedAt: "2026-04-12T00:05:00.000Z",
      },
      cycle: {
        completedCycles: 0,
        nextCycle: 1,
        latestFrontierIds: [],
      },
    };

    const server = createRalphResearchMcpServer({
      repoRoot,
      createResearchSessionOrchestratorService: () => ({
        startSession: async (input) => {
          startSessionCalls.push(input);
          return orchestratorResult;
        },
        continueSession: async () => {
          throw new Error("continueSession should not be called by start_session");
        },
      }),
    });
    const tool = (server as any)._registeredTools.start_session;
    const result = await (server as any).executeToolHandler(tool, { draftSessionId: "launch-draft" }, {});
    const payload = parseJsonToolResponse(result);

    expect(startSessionCalls).toEqual([
      {
        repoRoot,
        draftSessionId: "launch-draft",
      },
    ]);
    expectObjectKeys(payload, ["cycle", "session", "step"]);
    expect(payload).toEqual({
      step: "session_started",
      session: {
        sessionId: "session-20260412-000500",
        status: "running",
        goal: "improve future holdout top-3 accuracy",
        workingDirectory: repoRoot,
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
          trackableGlobs: ["**/*.ts"],
          webSearch: true,
          shellCommandAllowlistAdditions: [],
          shellCommandAllowlistRemovals: [],
        },
        workspace: {
          strategy: "git_worktree",
          baseRef: "main",
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
        createdAt: "2026-04-12T00:05:00.000Z",
        updatedAt: "2026-04-12T00:05:00.000Z",
        endedAt: null,
        evidenceBundlePath: null,
      },
      cycle: {
        completedCycles: 0,
        nextCycle: 1,
        latestRunId: null,
        latestDecisionId: null,
        latestFrontierIds: [],
        lastSignals: null,
        run: null,
        decision: null,
        runResult: null,
      },
    });
  });

  it("maps resume_session ids to the orchestrator continue flow and returns a transport-safe payload", async () => {
    const repoRoot = join(tempRoot, "repo-resume");
    await mkdir(repoRoot, { recursive: true });
    const continueSessionCalls: Array<{ repoRoot: string; sessionId: string }> = [];
    const orchestratorResult: ResearchSessionOrchestratorStepResult = {
      step: "session_resumed",
      session: {
        sessionId: "session-20260412-001500",
        goal: "improve future holdout top-3 accuracy",
        workingDirectory: repoRoot,
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
        context: {
          trackableGlobs: ["**/*.ts"],
          webSearch: true,
          shellCommandAllowlistAdditions: [],
          shellCommandAllowlistRemovals: [],
        },
        workspace: {
          strategy: "git_worktree",
          baseRef: "main",
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
        },
        stopCondition: {
          type: "none",
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: false,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
        },
        createdAt: "2026-04-12T00:05:00.000Z",
        updatedAt: "2026-04-12T00:15:00.000Z",
      },
      cycle: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-002"],
      },
    };

    const server = createRalphResearchMcpServer({
      repoRoot,
      createResearchSessionOrchestratorService: () => ({
        startSession: async () => {
          throw new Error("startSession should not be called by resume_session");
        },
        continueSession: async (input) => {
          continueSessionCalls.push(input);
          return orchestratorResult;
        },
      }),
    });
    const tool = (server as any)._registeredTools.resume_session;
    const result = await (server as any).executeToolHandler(tool, { sessionId: "session-20260412-001500" }, {});
    const payload = parseJsonToolResponse(result);

    expect(continueSessionCalls).toEqual([
      {
        repoRoot,
        sessionId: "session-20260412-001500",
      },
    ]);
    expectObjectKeys(payload, ["cycle", "error", "ok", "recovery", "session", "step"]);
    expect(payload).toEqual({
      ok: true,
      error: null,
      recovery: null,
      step: "session_resumed",
      session: {
        sessionId: "session-20260412-001500",
        status: "running",
        goal: "improve future holdout top-3 accuracy",
        workingDirectory: repoRoot,
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
          trackableGlobs: ["**/*.ts"],
          webSearch: true,
          shellCommandAllowlistAdditions: [],
          shellCommandAllowlistRemovals: [],
        },
        workspace: {
          strategy: "git_worktree",
          baseRef: "main",
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
        },
        stopCondition: {
          type: "none",
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: false,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
        },
        createdAt: "2026-04-12T00:05:00.000Z",
        updatedAt: "2026-04-12T00:15:00.000Z",
        endedAt: null,
        evidenceBundlePath: null,
      },
      cycle: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-002"],
        lastSignals: null,
        run: null,
        decision: null,
        runResult: null,
      },
    });
  });

  it("returns a transport-safe failure payload when resume_session cannot safely continue", async () => {
    const repoRoot = join(tempRoot, "repo-resume-failure");
    await mkdir(repoRoot, { recursive: true });

    const server = createRalphResearchMcpServer({
      repoRoot,
      createResearchSessionOrchestratorService: () => ({
        startSession: async () => {
          throw new Error("startSession should not be called by resume_session");
        },
        continueSession: async () => {
          throw new Error(
            "Session session-001 cannot resume safely: awaiting_resume session is missing Codex lifecycle evidence",
          );
        },
      }),
      createResearchSessionRecoveryService: () => ({
        inspectSession: async () => ({
          session: {
            sessionId: "session-001",
            goal: "improve future holdout top-3 accuracy",
            workingDirectory: repoRoot,
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
            context: {
              trackableGlobs: ["**/*.ts"],
              webSearch: true,
              shellCommandAllowlistAdditions: [],
              shellCommandAllowlistRemovals: [],
            },
            workspace: {
              strategy: "git_worktree",
              baseRef: "main",
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
              lastSignals: {
                cycle: 2,
                outcome: "accepted",
                changedFileCount: 1,
                diffLineCount: 18,
                meaningfulProgress: true,
                insufficientEvidence: false,
                agentTieBreakerUsed: false,
                repeatedDiff: false,
                newArtifacts: ["reports/holdout-cycle-2.json"],
                reasons: ["Holdout top-3 score improved."],
              },
            },
            stopCondition: {
              type: "none",
            },
            resume: {
              resumable: true,
              checkpointType: "completed_cycle_boundary",
              resumeFromCycle: 3,
              requiresUserConfirmation: true,
              checkpointRunId: "run-002",
              checkpointDecisionId: "decision-002",
              interruptionDetectedAt: "2026-04-12T00:16:00.000Z",
              interruptedDuringCycle: 3,
              note: "Lifecycle evidence missing.",
            },
            createdAt: "2026-04-12T00:05:00.000Z",
            updatedAt: "2026-04-12T00:16:00.000Z",
          },
          lifecycle: null,
          recovery: {
            classification: "inspect_only" as const,
            resumeAllowed: false,
            reason: "awaiting_resume session is missing Codex lifecycle evidence",
            runtime: {
              state: "missing" as const,
              processAlive: false,
              stale: false,
            },
          },
        }),
      }),
    });
    const tool = (server as any)._registeredTools.resume_session;
    const result = await (server as any).executeToolHandler(tool, { sessionId: "session-001" }, {});
    const payload = parseJsonToolResponse(result);

    expectObjectKeys(payload, ["cycle", "error", "ok", "recovery", "session", "step"]);
    expect(payload).toEqual({
      ok: false,
      error: "Session session-001 cannot resume safely: awaiting_resume session is missing Codex lifecycle evidence",
      recovery: {
        classification: "inspect_only",
        resumeAllowed: false,
        reason: "awaiting_resume session is missing Codex lifecycle evidence",
        runtime: {
          state: "missing",
          processAlive: false,
          stale: false,
        },
      },
      step: "resume_failed",
      session: {
        sessionId: "session-001",
        status: "awaiting_resume",
        goal: "improve future holdout top-3 accuracy",
        workingDirectory: repoRoot,
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
          trackableGlobs: ["**/*.ts"],
          webSearch: true,
          shellCommandAllowlistAdditions: [],
          shellCommandAllowlistRemovals: [],
        },
        workspace: {
          strategy: "git_worktree",
          baseRef: "main",
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
          lastSignals: {
            cycle: 2,
            outcome: "accepted",
            changedFileCount: 1,
            diffLineCount: 18,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            repeatedDiff: false,
            newArtifacts: ["reports/holdout-cycle-2.json"],
            reasons: ["Holdout top-3 score improved."],
          },
        },
        stopCondition: {
          type: "none",
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: true,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
          interruptionDetectedAt: "2026-04-12T00:16:00.000Z",
          interruptedDuringCycle: 3,
          note: "Lifecycle evidence missing.",
        },
        createdAt: "2026-04-12T00:05:00.000Z",
        updatedAt: "2026-04-12T00:16:00.000Z",
        endedAt: null,
        evidenceBundlePath: null,
      },
      cycle: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-002"],
        lastSignals: {
          cycle: 2,
          outcome: "accepted",
          changedFileCount: 1,
          diffLineCount: 18,
          meaningfulProgress: true,
          insufficientEvidence: false,
          agentTieBreakerUsed: false,
          repeatedDiff: false,
          newArtifacts: ["reports/holdout-cycle-2.json"],
          reasons: ["Holdout top-3 score improved."],
        },
        run: null,
        decision: null,
        runResult: null,
      },
    });
  });

  it("exposes the shared recovery classification from get_research_status", async () => {
    const repoRoot = join(tempRoot, "repo-status");
    await initNumericFixtureRepo(repoRoot);
    await seedCommittedRun(repoRoot);

    const server = createRalphResearchMcpServer({ repoRoot });
    const tool = (server as any)._registeredTools.get_research_status;
    const result = await (server as any).executeToolHandler(tool, { repoRoot }, {});
    const payload = parseJsonToolResponse(result);

    expectObjectKeys(payload, [
      "decisions",
      "frontier",
      "latestRun",
      "manifestPath",
      "pendingHumanRuns",
      "recovery",
      "runtime",
    ]);
    expect(payload).toEqual({
      manifestPath: join(repoRoot, "ralph.yaml"),
      latestRun: {
        runId: "run-0001",
        cycle: 1,
        candidateId: "candidate-0001",
        status: "accepted",
        phase: "committed",
        pendingAction: "update_frontier",
        startedAt: "2026-03-29T00:00:00.000Z",
        manifestHash: "manifest-hash",
        workspaceRef: "main",
        proposal: {
          proposerType: "command",
          summary: "proposal pending",
          operators: [],
        },
        artifacts: [],
        metrics: {},
        constraints: [],
        decisionId: "decision-run-0001",
        logs: {},
      },
      recovery: {
        classification: "repair_required",
        nextAction: "none",
        reason: "commit checkpoint is missing a durable commit sha",
        resumeAllowed: false,
      },
      runtime: {
        state: "stopped",
        processAlive: false,
        stale: false,
        resumable: false,
        reason: "repair required",
        lockPath: join(repoRoot, ".ralph", "lock"),
        currentStep: "none",
        lastProgressAt: "2026-03-29T00:00:00.000Z",
      },
      frontier: [],
      pendingHumanRuns: [],
      decisions: [],
    });
  });

  it("keeps get_frontier response shape unchanged", async () => {
    const repoRoot = join(tempRoot, "repo-frontier");
    await initNumericFixtureRepo(repoRoot);
    await seedCommittedRun(repoRoot);

    const server = createRalphResearchMcpServer({ repoRoot });
    const tool = (server as any)._registeredTools.get_frontier;
    const result = await (server as any).executeToolHandler(tool, { repoRoot }, {});
    const payload = parseJsonToolResponse(result);

    expectObjectKeys(payload, ["frontier", "manifestPath"]);
    expect(payload).toEqual({
      manifestPath: join(repoRoot, "ralph.yaml"),
      frontier: [],
    });
  });

  it("auto-resumes the latest recoverable run through run_research_cycle", async () => {
    const repoRoot = join(tempRoot, "repo-run");
    await initNumericFixtureRepo(repoRoot);
    await seedProposedRun(repoRoot);

    const server = createRalphResearchMcpServer({ repoRoot });
    const tool = (server as any)._registeredTools.run_research_cycle;
    const result = await (server as any).executeToolHandler(tool, { repoRoot, cycles: 1 }, {});
    const payload = parseJsonToolResponse(result);

    expectObjectKeys(payload, ["cycles", "cyclesExecuted", "ok", "results", "stopReason", "warnings"]);
    expect(payload.ok).toBe(true);
    expect(payload.cycles).toBe(1);
    expect(payload.cyclesExecuted).toBe(1);
    expect(payload.stopReason).toBe("completed 1 cycle(s)");
    expect(Array.isArray(payload.warnings)).toBe(true);
    expect(payload.warnings).toEqual([]);
    expect(Array.isArray(payload.results)).toBe(true);
    expect(payload.results).toHaveLength(1);
    expectObjectKeys(payload.results[0], ["lockPath", "manifestPath", "recovery", "runResult", "status"]);
    expectObjectKeys(payload.results[0].recovery, [
      "classification",
      "nextAction",
      "reason",
      "resumeAllowed",
    ]);
    expectObjectKeys(payload.results[0].runResult, [
      "auditQueue",
      "changeBudget",
      "decision",
      "frontier",
      "run",
      "status",
    ]);
    expectObjectKeys(payload.results[0].runResult.run, [
      "artifacts",
      "candidateId",
      "constraints",
      "cycle",
      "decisionId",
      "endedAt",
      "logs",
      "manifestHash",
      "metrics",
      "pendingAction",
      "phase",
      "proposal",
      "runId",
      "startedAt",
      "status",
      "updatedAt",
      "workspacePath",
      "workspaceRef",
      "currentStepStartedAt",
    ]);
    expectObjectKeys(payload.results[0].runResult.decision, [
      "actorType",
      "afterFrontierIds",
      "auditRequired",
      "beforeFrontierIds",
      "commitSha",
      "createdAt",
      "decisionId",
      "frontierChanged",
      "metricId",
      "outcome",
      "policyType",
      "reason",
      "runId",
    ]);
    expectObjectKeys(payload.results[0].runResult.changeBudget, [
      "outcome",
      "reason",
      "summary",
      "violations",
      "withinBudget",
    ]);
    expect(payload.results[0]?.runResult?.run.runId).toBe("run-0001");
  });
});

function parseJsonToolResponse(result: unknown): Record<string, any> {
  expect(result).toMatchObject({
    content: [
      {
        type: "text",
      },
    ],
  });

  const response = result as {
    content: Array<{
      type: "text";
      text: string;
    }>;
  };

  expect(response.content).toHaveLength(1);
  expect(typeof response.content[0]?.text).toBe("string");

  return JSON.parse(response.content[0]!.text) as Record<string, any>;
}

function expectObjectKeys(value: Record<string, unknown>, keys: string[]): void {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

async function seedProposedRun(repoRoot: string): Promise<void> {
  const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
  const workspaceManager = new GitWorktreeWorkspaceManager(repoRoot, join(repoRoot, ".ralph"));
  const workspace = await workspaceManager.createWorkspace("candidate-0001", "main");
  await writeFile(join(workspace.workspacePath, "docs", "draft.md"), "Recovered draft.\n", "utf8");
  const proposeLogDir = join(repoRoot, ".ralph", "runs", "run-0001", "logs");
  const proposeLogPath = join(proposeLogDir, "candidate-0001.propose.stdout.log");
  await mkdir(proposeLogDir, { recursive: true });
  await writeFile(proposeLogPath, "proposal complete\n", "utf8");

  await runStore.put(
    makeRunRecord({
      phase: "proposed",
      pendingAction: "execute_experiment",
      updatedAt: "2026-03-29T00:01:00.000Z",
      currentStepStartedAt: "2026-03-29T00:01:00.000Z",
      workspacePath: workspace.workspacePath,
      proposal: {
        proposerType: "command",
        summary: "Recovered proposal",
        operators: [],
      },
      logs: {
        proposeStdoutPath: proposeLogPath,
      },
    }),
  );
}

async function seedCommittedRun(repoRoot: string): Promise<void> {
  const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
  await runStore.put(
    makeRunRecord({
      status: "accepted",
      phase: "committed",
      pendingAction: "update_frontier",
      decisionId: "decision-run-0001",
    }),
  );
}

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-0001",
    cycle: 1,
    candidateId: "candidate-0001",
    status: "running",
    phase: "started",
    pendingAction: "prepare_proposal",
    startedAt: "2026-03-29T00:00:00.000Z",
    manifestHash: "manifest-hash",
    workspaceRef: "main",
    proposal: {
      proposerType: "command",
      summary: "proposal pending",
      operators: [],
    },
    artifacts: [],
    metrics: {},
    constraints: [],
    logs: {},
    ...overrides,
  };
}
