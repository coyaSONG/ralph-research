import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireLock, releaseLock } from "../src/adapters/fs/lockfile.js";
import { JsonFileDecisionStore } from "../src/adapters/fs/json-file-decision-store.js";
import { JsonFileFrontierStore } from "../src/adapters/fs/json-file-frontier-store.js";
import { JsonFileRunStore } from "../src/adapters/fs/json-file-run-store.js";
import { ManualDecisionService } from "../src/app/services/manual-decision-service.js";
import { getProjectFrontier, getProjectStatus, inspectRun } from "../src/app/services/project-state-service.js";
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

  it("reports a live runtime view when the run-cycle heartbeat is active", async () => {
    const repoRoot = join(tempRoot, "repo-runtime-alive");
    await initNumericFixtureRepo(repoRoot);
    await seedProposedRun(repoRoot);

    const lock = await acquireLock(join(repoRoot, ".ralph", "lock"), {
      owner: {
        operation: "run-cycle",
      },
    });

    try {
      const status = await getProjectStatus({ repoRoot });

      expect(status.runtime).toMatchObject({
        state: "running",
        processAlive: true,
        stale: false,
        resumable: true,
        pid: process.pid,
        currentStep: "execute_experiment",
        currentStepStartedAt: "2026-03-29T00:01:00.000Z",
        lastProgressAt: "2026-03-29T00:01:00.000Z",
      });
      expect(status.runtime.lastHeartbeatAt).toBeTruthy();
    } finally {
      await releaseLock(lock.path, lock.metadata.token);
    }
  });

  it("reports stale resumable runtime metadata when only the persisted checkpoint remains", async () => {
    const repoRoot = join(tempRoot, "repo-runtime-stale");
    await initNumericFixtureRepo(repoRoot);
    await seedProposedRun(repoRoot);
    await mkdir(join(repoRoot, ".ralph"), { recursive: true });
    await writeFile(
      join(repoRoot, ".ralph", "lock"),
      `${JSON.stringify({
        pid: 999_999,
        token: "stale-token",
        createdAt: "2026-04-06T13:45:00.000Z",
        updatedAt: "2026-04-06T13:49:10.000Z",
        ttlMs: 300_000,
        graceMs: 30_000,
        owner: {
          operation: "run-cycle",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const status = await getProjectStatus({ repoRoot });

    expect(status.latestRun?.status).toBe("running");
    expect(status.runtime).toMatchObject({
      state: "stale",
      processAlive: false,
      stale: true,
      resumable: true,
      pid: 999_999,
      lastHeartbeatAt: "2026-04-06T13:49:10.000Z",
      currentStep: "execute_experiment",
      currentStepStartedAt: "2026-03-29T00:01:00.000Z",
      lastProgressAt: "2026-03-29T00:01:00.000Z",
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

  it("surfaces metric diagnostics and source ids in inspect output", async () => {
    const repoRoot = join(tempRoot, "repo-metric-diagnostics");
    await initNumericFixtureRepo(repoRoot);
    await seedDecisionWrittenRun(repoRoot, {
      status: "rejected",
      decision: makeDecisionRecord({
        outcome: "rejected",
        reason: "quality candidate=0; diagnostics=all_missing_features,normalized_order_leak",
        diagnostics: {
          sourceMetricId: "overfit_safe_exact_rate",
          reasons: ["all_missing_features", "normalized_order_leak"],
        },
      }),
    });

    const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
    await runStore.put(
      makeRunRecord({
        status: "rejected",
        phase: "decision_written",
        pendingAction: "none",
        decisionId: "decision-run-0001",
        metrics: {
          quality: {
            metricId: "quality",
            value: 0,
            direction: "maximize",
            details: {
              sourceMetricId: "overfit_safe_exact_rate",
              reasons: ["all_missing_features", "normalized_order_leak"],
            },
          },
        },
      }),
    );

    const result = await inspectRun({
      repoRoot,
      runId: "run-0001",
    });

    expect(result.decision?.diagnostics).toMatchObject({
      sourceMetricId: "overfit_safe_exact_rate",
      reasons: ["all_missing_features", "normalized_order_leak"],
    });
    expect(result.explainability.metricDiagnostics).toEqual([
      {
        metricId: "quality",
        sourceMetricId: "overfit_safe_exact_rate",
        reasons: ["all_missing_features", "normalized_order_leak"],
      },
    ]);
    expect(result.explainability.metricDeltas[0]?.sourceMetricId).toBe("overfit_safe_exact_rate");
  });

  it("returns rebuilt frontier state from accepted records without writing a missing snapshot", async () => {
    const repoRoot = join(tempRoot, "repo-frontier-rebuild");
    await initNumericFixtureRepo(repoRoot);
    await seedAcceptedFrontierRecord(repoRoot);

    const status = await getProjectStatus({ repoRoot });

    expect(status.frontier).toHaveLength(1);
    expect(status.frontier[0]?.runId).toBe("run-0001");
    expect(await pathExists(join(repoRoot, ".ralph", "frontier.json"))).toBe(false);
  });

  it("returns rebuilt frontier snapshots without overwriting stale persisted snapshots", async () => {
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
    const persistedFrontier = await frontierStore.load();

    expect(status.frontier[0]?.runId).toBe("run-0001");
    expect(persistedFrontier[0]?.runId).toBe("run-stale");
  });

  it("returns rebuilt frontier without overwriting a malformed persisted snapshot", async () => {
    const repoRoot = join(tempRoot, "repo-frontier-malformed");
    await initNumericFixtureRepo(repoRoot);
    await seedAcceptedFrontierRecord(repoRoot);
    const frontierPath = join(repoRoot, ".ralph", "frontier.json");
    await mkdir(join(repoRoot, ".ralph"), { recursive: true });
    await writeFile(frontierPath, "not json\n", "utf8");

    const status = await getProjectStatus({ repoRoot });

    expect(status.frontier.map((entry) => entry.runId)).toEqual(["run-0001"]);
    expect(await readFile(frontierPath, "utf8")).toBe("not json\n");
  });

  it("surfaces non-snapshot IO errors while reading frontier state", async () => {
    const repoRoot = join(tempRoot, "repo-frontier-io-error");
    await initNumericFixtureRepo(repoRoot);
    await seedAcceptedFrontierRecord(repoRoot);
    await mkdir(join(repoRoot, ".ralph", "frontier.json"), { recursive: true });

    await expect(getProjectStatus({ repoRoot })).rejects.toMatchObject({
      code: "EISDIR",
    });
  });

  it("returns current frontier without writing from the frontier read model", async () => {
    const repoRoot = join(tempRoot, "repo-frontier-read-model");
    await initNumericFixtureRepo(repoRoot);
    await seedAcceptedFrontierRecord(repoRoot);

    const result = await getProjectFrontier({ repoRoot });

    expect(result.frontier.map((entry) => entry.runId)).toEqual(["run-0001"]);
    expect(await pathExists(join(repoRoot, ".ralph", "frontier.json"))).toBe(false);
  });

  it("reports aligned read models after manual accept", async () => {
    const repoRoot = join(tempRoot, "repo-manual-accept");
    await initNumericFixtureRepo(repoRoot);
    await seedPendingHumanReviewRun(repoRoot, {
      runId: "run-0001",
      candidateId: "candidate-0001",
      decisionId: "decision-run-0001",
      metrics: {
        quality: makeMetricResult("quality", 0.9),
      },
    });

    await new ManualDecisionService().accept({
      repoRoot,
      runId: "run-0001",
      by: "reviewer",
    });

    const status = await getProjectStatus({ repoRoot });
    const inspect = await inspectRun({ repoRoot, runId: "run-0001" });

    expect(status.latestRun?.status).toBe("accepted");
    expect(status.pendingHumanRuns).toHaveLength(0);
    expect(status.frontier.map((entry) => entry.runId)).toEqual(["run-0001"]);
    expect(inspect.run.status).toBe("accepted");
    expect(inspect.decision?.outcome).toBe("accepted");
    expect(inspect.frontier.map((entry) => entry.runId)).toEqual(["run-0001"]);
  });

  it("reports aligned read models after manual reject", async () => {
    const repoRoot = join(tempRoot, "repo-manual-reject");
    await initNumericFixtureRepo(repoRoot);
    await seedAcceptedHistoryRun(repoRoot, {
      runId: "run-0001",
      candidateId: "candidate-0001",
      decisionId: "decision-run-0001",
      metrics: {
        quality: makeMetricResult("quality", 0.8),
      },
    });
    await seedPendingHumanReviewRun(repoRoot, {
      runId: "run-0002",
      candidateId: "candidate-0002",
      decisionId: "decision-run-0002",
      metrics: {
        quality: makeMetricResult("quality", 0.7),
      },
    });

    await new ManualDecisionService().reject({
      repoRoot,
      runId: "run-0002",
      by: "reviewer",
    });

    const status = await getProjectStatus({ repoRoot });
    const inspect = await inspectRun({ repoRoot, runId: "run-0002" });

    expect(status.latestRun?.status).toBe("rejected");
    expect(status.pendingHumanRuns).toHaveLength(0);
    expect(status.frontier.map((entry) => entry.runId)).toEqual(["run-0001"]);
    expect(inspect.run.status).toBe("rejected");
    expect(inspect.decision?.outcome).toBe("rejected");
    expect(inspect.frontier.map((entry) => entry.runId)).toEqual(["run-0001"]);
  });

  it("uses manifest storage root for project status locks and state", async () => {
    const repoRoot = join(tempRoot, "repo-custom-storage-status");
    await initNumericFixtureRepo(repoRoot);
    await rewriteStorageRoot(repoRoot, ".rrx");
    await seedDecisionWrittenRun(repoRoot, {
      status: "needs_human",
      decision: makeDecisionRecord({
        outcome: "needs_human",
      }),
    }, ".rrx");
    const lock = await acquireLock(join(repoRoot, ".rrx", "lock"), {
      owner: {
        operation: "run-cycle",
      },
    });

    try {
      const status = await getProjectStatus({ repoRoot });

      expect(status.latestRun?.runId).toBe("run-0001");
      expect(status.runtime.lockPath).toBe(join(repoRoot, ".rrx", "lock"));
      expect(status.runtime.state).toBe("stopped");
      expect(await pathExists(join(repoRoot, ".ralph", "lock"))).toBe(false);
    } finally {
      await releaseLock(lock.path, lock.metadata.token);
    }
  });

  it("uses manifest storage root for manual decisions", async () => {
    const repoRoot = join(tempRoot, "repo-custom-storage-manual");
    await initNumericFixtureRepo(repoRoot);
    await rewriteStorageRoot(repoRoot, ".rrx");
    await seedDecisionWrittenRun(repoRoot, {
      status: "needs_human",
      decision: makeDecisionRecord({
        outcome: "needs_human",
      }),
    }, ".rrx");

    await new ManualDecisionService().reject({
      repoRoot,
      runId: "run-0001",
      by: "reviewer",
    });

    const runStore = new JsonFileRunStore(join(repoRoot, ".rrx", "runs"));
    const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".rrx", "decisions"));
    expect((await runStore.get("run-0001"))?.status).toBe("rejected");
    expect((await decisionStore.get("decision-run-0001"))?.outcome).toBe("rejected");
    expect(await pathExists(join(repoRoot, ".ralph", "lock"))).toBe(false);
  });

  it("uses repo-aware manifest admission for project status", async () => {
    const repoRoot = join(tempRoot, "repo-status-admission");
    await initNumericFixtureRepo(repoRoot);
    await writeFile(
      join(repoRoot, "ralph.yaml"),
      (await readFile(join(repoRoot, "ralph.yaml"), "utf8")).replace("baselineRef: main", "baselineRef: does-not-exist"),
      "utf8",
    );

    await expect(getProjectStatus({ repoRoot })).rejects.toMatchObject({
      name: "ManifestLoadError",
    });
    expect(await pathExists(join(repoRoot, ".ralph", "lock"))).toBe(false);
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

async function seedDecisionWrittenRun(
  repoRoot: string,
  input: {
    status: "accepted" | "rejected" | "needs_human";
    decision: DecisionRecord;
  },
  storageRoot = ".ralph",
): Promise<void> {
  const runStore = new JsonFileRunStore(join(repoRoot, storageRoot, "runs"));
  const decisionStore = new JsonFileDecisionStore(join(repoRoot, storageRoot, "decisions"));
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

async function seedAcceptedHistoryRun(
  repoRoot: string,
  input: {
    runId: string;
    candidateId: string;
    decisionId: string;
    metrics: RunRecord["metrics"];
  },
): Promise<void> {
  const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
  const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".ralph", "decisions"));
  const artifactPath = join(repoRoot, ".ralph", "runs", input.runId, "artifacts", "draft.md");

  await mkdir(join(repoRoot, ".ralph", "runs", input.runId, "artifacts"), { recursive: true });
  await writeFile(artifactPath, `${input.runId} artifact\n`, "utf8");

  await runStore.put(
    makeRunRecord({
      runId: input.runId,
      candidateId: input.candidateId,
      status: "accepted",
      phase: "completed",
      pendingAction: "none",
      endedAt: "2026-03-29T00:10:00.000Z",
      decisionId: input.decisionId,
      metrics: input.metrics,
      artifacts: [
        {
          id: "draft",
          path: artifactPath,
        },
      ],
    }),
  );

  await decisionStore.put(
    makeDecisionRecord({
      decisionId: input.decisionId,
      runId: input.runId,
      metricId: "quality",
      commitSha: `commit-${input.runId}`,
      createdAt: "2026-03-29T00:10:00.000Z",
      afterFrontierIds: [`frontier-${input.runId}`],
    }),
  );
}

async function seedPendingHumanReviewRun(
  repoRoot: string,
  input: {
    runId: string;
    candidateId: string;
    decisionId: string;
    metrics: RunRecord["metrics"];
  },
): Promise<void> {
  const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
  const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".ralph", "decisions"));
  const workspaceManager = new GitWorktreeWorkspaceManager(repoRoot, join(repoRoot, ".ralph"));
  const workspace = await workspaceManager.createWorkspace(input.candidateId, "main");
  const artifactPath = join(repoRoot, ".ralph", "runs", input.runId, "artifacts", "draft.md");

  await writeFile(join(workspace.workspacePath, "docs", "draft.md"), `${input.runId} improved draft\n`, "utf8");
  await mkdir(join(repoRoot, ".ralph", "runs", input.runId, "artifacts"), { recursive: true });
  await writeFile(artifactPath, `${input.runId} artifact\n`, "utf8");

  await runStore.put(
    makeRunRecord({
      runId: input.runId,
      candidateId: input.candidateId,
      status: "needs_human",
      phase: "decision_written",
      pendingAction: "none",
      workspacePath: workspace.workspacePath,
      decisionId: input.decisionId,
      proposal: {
        proposerType: "command",
        summary: "pending human review",
        operators: [],
        changedPaths: ["docs/draft.md"],
        filesChanged: 1,
        diffLines: 1,
        withinBudget: true,
      },
      metrics: input.metrics,
      artifacts: [
        {
          id: "draft",
          path: artifactPath,
        },
      ],
    }),
  );

  await decisionStore.put(
    makeDecisionRecord({
      decisionId: input.decisionId,
      runId: input.runId,
      outcome: "needs_human",
      metricId: "quality",
      createdAt: "2026-03-30T00:05:00.000Z",
      frontierChanged: false,
      beforeFrontierIds: [],
      afterFrontierIds: [],
    }),
  );
}

async function rewriteStorageRoot(repoRoot: string, storageRoot: string): Promise<void> {
  const manifestPath = join(repoRoot, "ralph.yaml");
  await writeFile(
    manifestPath,
    (await readFile(manifestPath, "utf8")).replace("root: .ralph", `root: ${storageRoot}`),
    "utf8",
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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

function makeMetricResult(metricId: string, value: number): RunRecord["metrics"][string] {
  return {
    metricId,
    value,
    direction: "maximize",
    details: {},
  };
}
