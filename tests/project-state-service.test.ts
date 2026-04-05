import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonFileDecisionStore } from "../src/adapters/fs/json-file-decision-store.js";
import { JsonFileFrontierStore } from "../src/adapters/fs/json-file-frontier-store.js";
import { JsonFileRunStore } from "../src/adapters/fs/json-file-run-store.js";
import { getProjectStatus, inspectRun } from "../src/app/services/project-state-service.js";
import { GitWorktreeWorkspaceManager } from "../src/core/engine/workspace-manager.js";
import type { DecisionRecord } from "../src/core/model/decision-record.js";
import type { RunRecord } from "../src/core/model/run-record.js";
import { initNumericFixtureRepo } from "./helpers/fixture-repo.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-project-state-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("project-state-service recovery read model", () => {
  it("reports idle when no run exists", async () => {
    const repoRoot = join(tempRoot, "repo-idle");
    await initNumericFixtureRepo(repoRoot);

    const status = await getProjectStatus({ repoRoot });

    expect(status.latestRun).toBeNull();
    expect(status.recovery).toMatchObject({
      classification: "idle",
      nextAction: "none",
      resumeAllowed: false,
    });
  });

  it("reports resumable for a replay-safe proposed checkpoint", async () => {
    const repoRoot = join(tempRoot, "repo-resumable");
    await initNumericFixtureRepo(repoRoot);
    await seedProposedRun(repoRoot);

    const status = await getProjectStatus({ repoRoot });

    expect(status.latestRun?.runId).toBe("run-0001");
    expect(status.recovery).toMatchObject({
      classification: "resumable",
      nextAction: "execute_experiment",
      resumeAllowed: true,
    });
  });

  it("reports manual_review_blocked for needs_human runs", async () => {
    const repoRoot = join(tempRoot, "repo-manual-review");
    await initNumericFixtureRepo(repoRoot);
    await seedDecisionWrittenRun(repoRoot, {
      status: "needs_human",
      decision: makeDecisionRecord({
        outcome: "needs_human",
      }),
    });

    const status = await getProjectStatus({ repoRoot });

    expect(status.recovery).toMatchObject({
      classification: "manual_review_blocked",
      nextAction: "none",
      resumeAllowed: false,
    });
  });

  it("reports repair_required in inspect when accepted-path evidence is contradictory", async () => {
    const repoRoot = join(tempRoot, "repo-repair-required");
    await initNumericFixtureRepo(repoRoot);
    await seedCommittedRun(repoRoot);

    const result = await inspectRun({
      repoRoot,
      runId: "run-0001",
    });

    expect(result.recovery).toMatchObject({
      classification: "repair_required",
      nextAction: "none",
      resumeAllowed: false,
    });
    expect(result.recovery.reason).toContain("commit sha");
  });

  it("rebuilds frontier state from accepted records when the snapshot is missing", async () => {
    const repoRoot = join(tempRoot, "repo-frontier-rebuild");
    await initNumericFixtureRepo(repoRoot);
    await seedAcceptedFrontierRecord(repoRoot);

    const status = await getProjectStatus({ repoRoot });

    expect(status.frontier).toHaveLength(1);
    expect(status.frontier[0]?.runId).toBe("run-0001");
  });

  it("overwrites stale frontier snapshots with rebuilt state", async () => {
    const repoRoot = join(tempRoot, "repo-frontier-stale");
    await initNumericFixtureRepo(repoRoot);
    await seedAcceptedFrontierRecord(repoRoot);

    const frontierStore = new JsonFileFrontierStore(join(repoRoot, ".ralph", "frontier.json"));
    await frontierStore.save([
      {
        frontierId: "frontier-stale",
        runId: "run-stale",
        candidateId: "candidate-stale",
        acceptedAt: "2026-03-29T00:00:00.000Z",
        commitSha: "stale-sha",
        metrics: {
          quality: {
            metricId: "quality",
            value: 0.1,
            direction: "maximize",
            details: {},
          },
        },
        artifacts: [
          {
            id: "draft",
            path: "out/draft.md",
          },
        ],
      },
    ]);

    const status = await getProjectStatus({ repoRoot });
    const repairedFrontier = await frontierStore.load();

    expect(status.frontier[0]?.runId).toBe("run-0001");
    expect(repairedFrontier[0]?.runId).toBe("run-0001");
  });
});

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

async function seedDecisionWrittenRun(
  repoRoot: string,
  input: {
    status: "accepted" | "rejected" | "needs_human";
    decision: DecisionRecord;
  },
): Promise<void> {
  const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
  const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".ralph", "decisions"));
  await decisionStore.put(input.decision);

  await runStore.put(
    makeRunRecord({
      status: input.status,
      phase: "decision_written",
      pendingAction: input.status === "accepted" ? "commit_candidate" : "none",
      decisionId: input.decision.decisionId,
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

async function seedAcceptedFrontierRecord(repoRoot: string): Promise<void> {
  const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
  const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".ralph", "decisions"));

  await runStore.put(
    makeRunRecord({
      status: "accepted",
      phase: "completed",
      pendingAction: "none",
      endedAt: "2026-03-29T00:10:00.000Z",
      decisionId: "decision-run-0001",
      metrics: {
        quality: {
          metricId: "quality",
          value: 0.9,
          direction: "maximize",
          details: {},
        },
      },
      artifacts: [
        {
          id: "draft",
          path: "out/draft.md",
        },
      ],
    }),
  );

  await decisionStore.put(
    makeDecisionRecord({
      commitSha: "abc123",
      createdAt: "2026-03-29T00:10:00.000Z",
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

function makeDecisionRecord(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    decisionId: "decision-run-0001",
    runId: "run-0001",
    outcome: "accepted",
    actorType: "system",
    policyType: "epsilon_improve",
    metricId: "quality",
    reason: "accepted by test",
    createdAt: "2026-03-29T00:00:00.000Z",
    frontierChanged: true,
    beforeFrontierIds: [],
    afterFrontierIds: ["frontier-run-0001"],
    auditRequired: false,
    ...overrides,
  };
}
