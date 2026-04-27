import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonFileDecisionStore } from "../src/adapters/fs/json-file-decision-store.js";
import { JsonFileFrontierStore } from "../src/adapters/fs/json-file-frontier-store.js";
import { JsonFileRunStore } from "../src/adapters/fs/json-file-run-store.js";
import type { JudgeProvider, JudgeRequest, JudgeResponse } from "../src/adapters/judge/llm-judge-provider.js";
import { RunCycleService } from "../src/app/services/run-cycle-service.js";
import { ManifestLoadError } from "../src/adapters/fs/manifest-loader.js";
import { GitWorktreeWorkspaceManager } from "../src/core/engine/workspace-manager.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-service-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("RunCycleService integration", () => {
  it("runs an accepted cycle and persists run, decision, and frontier state", async () => {
    const repoRoot = await initFixtureRepo("numeric");
    const service = new RunCycleService();

    const result = await service.run({
      repoRoot,
    });

    expect(result.status).toBe("accepted");
    expect(result.runResult?.decision?.reason.length).toBeGreaterThan(0);
    expect(await readFile(join(repoRoot, "docs", "draft.md"), "utf8")).toContain("Improved draft");

    const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
    const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".ralph", "decisions"));
    const frontierStore = new JsonFileFrontierStore(join(repoRoot, ".ralph", "frontier.json"));

    const run = await runStore.get("run-0001");
    const decision = await decisionStore.get("decision-run-0001");
    const frontier = await frontierStore.load();
    const { stdout: headSha } = await execa("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
    const { stdout: committedPaths } = await execa("git", ["show", "--name-only", "--pretty=", "HEAD"], { cwd: repoRoot });

    expect(run?.status).toBe("accepted");
    expect(run?.phase).toBe("completed");
    expect(run?.proposal.patchPath).toBeTruthy();
    await expect(pathExists(run?.proposal.patchPath ?? "")).resolves.toBe(true);
    expect(decision?.outcome).toBe("accepted");
    expect(decision?.commitSha).toBeTruthy();
    expect(frontier).toHaveLength(1);
    expect(frontier[0]?.metrics.quality.value).toBeCloseTo(0.7);
    expect(frontier[0]?.commitSha).toBe(decision?.commitSha);
    expect(headSha.trim()).toBe(decision?.commitSha);
    expect(committedPaths.trim().split("\n")).toEqual(["docs/draft.md"]);
  });

  it("uses manifest storage root for run state and locks", async () => {
    const repoRoot = await initFixtureRepo("numeric");
    await writeFile(
      join(repoRoot, "ralph.yaml"),
      (await readFile(join(repoRoot, "ralph.yaml"), "utf8")).replace("root: .ralph", "root: .rrx"),
      "utf8",
    );
    const service = new RunCycleService();

    const result = await service.run({ repoRoot });

    expect(result.status).toBe("accepted");
    expect(result.lockPath).toBe(join(repoRoot, ".rrx", "lock"));
    expect(await pathExists(join(repoRoot, ".rrx", "runs", "run-0001.json"))).toBe(true);
    expect(await pathExists(join(repoRoot, ".rrx", "decisions", "decision-run-0001.json"))).toBe(true);
    expect(await pathExists(join(repoRoot, ".rrx", "frontier.json"))).toBe(true);
    expect(await pathExists(join(repoRoot, ".rrx", "lock"))).toBe(false);
    expect(await pathExists(join(repoRoot, ".ralph", "lock"))).toBe(false);
    expect(await pathExists(join(repoRoot, ".ralph", "runs"))).toBe(false);
  });

  it("runs a rejected cycle when the frontier incumbent is better", async () => {
    const repoRoot = await initFixtureRepo("numeric");
    const frontierStore = new JsonFileFrontierStore(join(repoRoot, ".ralph", "frontier.json"));

    await frontierStore.save([
      {
        frontierId: "frontier-existing",
        runId: "run-existing",
        candidateId: "candidate-existing",
        acceptedAt: "2026-03-29T00:00:00.000Z",
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
            path: join(repoRoot, "docs", "draft.md"),
          },
        ],
      },
    ]);

    const service = new RunCycleService();
    const result = await service.run({ repoRoot });

    expect(result.status).toBe("rejected");
    expect(result.runResult?.decision?.reason.length).toBeGreaterThan(0);

    const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
    const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".ralph", "decisions"));
    const storedRun = await runStore.get("run-0001");
    const storedDecision = await decisionStore.get("decision-run-0001");
    const storedFrontier = await frontierStore.load();

    expect(storedRun?.status).toBe("rejected");
    expect(storedDecision?.outcome).toBe("rejected");
    expect(storedFrontier[0]?.frontierId).toBe("frontier-existing");
  });

  it("warns when git workspace command scripts have uncommitted changes", async () => {
    const repoRoot = await initFixtureRepo("numeric");
    await writeFile(join(repoRoot, "scripts", "metric.mjs"), 'console.log("0.95");\n', "utf8");

    const service = new RunCycleService();
    const result = await service.run({ repoRoot });

    expect(result.status).toBe("accepted");
    expect(result.warning).toContain("scripts/metric.mjs (metric quality)");
  });

  it("persists structured metric diagnostics into decision and run state", async () => {
    const repoRoot = await initFixtureRepo("numeric");
    const frontierStore = new JsonFileFrontierStore(join(repoRoot, ".ralph", "frontier.json"));

    await frontierStore.save([
      {
        frontierId: "frontier-existing",
        runId: "run-existing",
        candidateId: "candidate-existing",
        acceptedAt: "2026-03-29T00:00:00.000Z",
        metrics: {
          quality: {
            metricId: "quality",
            value: 0.8,
            direction: "maximize",
            details: {},
          },
        },
        artifacts: [
          {
            id: "draft",
            path: join(repoRoot, "docs", "draft.md"),
          },
        ],
      },
    ]);

    await writeFile(
      join(repoRoot, "scripts", "metric.mjs"),
      'console.log(JSON.stringify({ value: 0, metricId: "overfit_safe_exact_rate", reasons: ["all_missing_features", "normalized_order_leak"] }));\n',
      "utf8",
    );
    await writeFile(join(repoRoot, "ralph.yaml"), buildJsonMetricManifest(), "utf8");
    await execa("git", ["add", "ralph.yaml", "scripts/metric.mjs"], { cwd: repoRoot });
    await execa("git", ["commit", "-m", "switch metric extractor"], { cwd: repoRoot });

    const service = new RunCycleService();
    const result = await service.run({ repoRoot });

    expect(result.status).toBe("rejected");
    expect(result.runResult?.decision?.reason).toContain("all_missing_features");
    expect(result.runResult?.decision?.diagnostics).toMatchObject({
      sourceMetricId: "overfit_safe_exact_rate",
      reasons: ["all_missing_features", "normalized_order_leak"],
    });
    expect(result.runResult?.run.metrics.quality?.details).toMatchObject({
      sourceMetricId: "overfit_safe_exact_rate",
      reasons: ["all_missing_features", "normalized_order_leak"],
    });
  });

  it("runs a needs_human cycle when low-confidence judge output cannot auto-accept", async () => {
    const repoRoot = await initFixtureRepo("judge");
    const frontierStore = new JsonFileFrontierStore(join(repoRoot, ".ralph", "frontier.json"));

    await frontierStore.save([
      {
        frontierId: "frontier-existing",
        runId: "run-existing",
        candidateId: "candidate-existing",
        acceptedAt: "2026-03-29T00:00:00.000Z",
        metrics: {
          paper_quality: {
            metricId: "paper_quality",
            value: 0.5,
            direction: "maximize",
            confidence: 0.95,
            details: {},
          },
        },
        artifacts: [
          {
            id: "draft",
            path: join(repoRoot, "docs", "draft.md"),
          },
        ],
      },
    ]);

    const service = new RunCycleService({
      judgeProvider: createSequentialJudgeProvider([
        pairwise("candidate", 0.2),
        pairwise("candidate", 0.3),
        pairwise("candidate", 0.4),
        pairwise("incumbent", 0.3),
        pairwise("incumbent", 0.4),
      ]),
    });

    const result = await service.run({ repoRoot });

    expect(result.status).toBe("needs_human");
    expect(result.runResult?.decision?.reason).toContain("below threshold");

    const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
    const storedRun = await runStore.get("run-0001");
    expect(storedRun?.status).toBe("needs_human");
    expect(storedRun?.metrics.paper_quality?.confidence).toBeLessThan(0.75);
  });

  it("graduates from approval_gate into epsilon_improve after consecutive accepts", async () => {
    const repoRoot = await initFixtureRepo("graduation");
    const frontierStore = new JsonFileFrontierStore(join(repoRoot, ".ralph", "frontier.json"));

    await frontierStore.save([
      {
        frontierId: "frontier-existing",
        runId: "run-existing",
        candidateId: "candidate-existing",
        acceptedAt: "2026-03-29T00:00:00.000Z",
        metrics: {
          feasibility: {
            metricId: "feasibility",
            value: 0.5,
            direction: "maximize",
            confidence: 0.95,
            details: {},
          },
        },
        artifacts: [
          {
            id: "draft",
            path: join(repoRoot, "docs", "draft.md"),
          },
        ],
      },
    ]);

    const service = new RunCycleService({
      judgeProvider: createSequentialJudgeProvider([
        ...Array.from({ length: 5 }, () => absolute(0.7, 0.9)),
        ...Array.from({ length: 5 }, () => absolute(0.8, 0.9)),
        ...Array.from({ length: 5 }, () => absolute(0.86, 0.4)),
      ]),
    });

    const run1 = await service.run({ repoRoot });
    const run2 = await service.run({ repoRoot });
    const run3 = await service.run({ repoRoot });

    expect(run1.status).toBe("accepted");
    expect(run2.status).toBe("accepted");
    expect(run3.status).toBe("accepted");

    const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".ralph", "decisions"));
    const decision2 = await decisionStore.get("decision-run-0002");
    const decision3 = await decisionStore.get("decision-run-0003");

    expect(decision2?.graduation).toMatchObject({
      activatedPolicy: "epsilon_improve",
      consecutiveAccepts: 2,
      epsilon: 0.05,
    });
    expect(decision3?.policyType).toBe("epsilon_improve");
    expect(decision3?.reason).toContain("graduated autonomy active");
  });

  it("injects compacted history into the proposer when history mode is enabled", async () => {
    const repoRoot = await initFixtureRepo("history");
    const service = new RunCycleService();

    const run1 = await service.run({ repoRoot });
    const run2 = await service.run({ repoRoot });

    expect(run1.status).toBe("accepted");
    expect(run2.status).toBe("accepted");
    expect(run2.runResult?.run.proposal.summary).toContain("history_context=enabled");

    const draft = await readFile(join(repoRoot, "docs", "draft.md"), "utf8");
    expect(draft).toContain("run-0001");
    expect(draft).toContain("decision=accepted");
  });

  it("runs parallel proposers and selects the best candidate by metric", async () => {
    const repoRoot = await initFixtureRepo("parallel");
    const service = new RunCycleService();

    const result = await service.run({ repoRoot });

    expect(result.status).toBe("accepted");
    expect(result.runResult?.run.proposal.proposerType).toBe("parallel");
    expect(result.runResult?.run.proposal.summary).toContain("selected strategy 3");
    expect(await readFile(join(repoRoot, "docs", "draft.md"), "utf8")).toContain("Candidate C");

    const frontierStore = new JsonFileFrontierStore(join(repoRoot, ".ralph", "frontier.json"));
    const frontier = await frontierStore.load();
    expect(frontier[0]?.metrics.quality.value).toBeCloseTo(0.9);
  });

  it("fails unsupported workspace manifests before creating lock, runs, or workspaces", async () => {
    const repoRoot = await initFixtureRepo("numeric", { workspace: "copy" });
    const service = new RunCycleService();

    await expect(service.run({ repoRoot })).rejects.toMatchObject({
      name: "ManifestLoadError",
      causeValue: {
        issues: [
          expect.objectContaining({
            path: ["project", "workspace"],
          }),
        ],
      },
    } satisfies Partial<ManifestLoadError>);

    await expect(pathExists(join(repoRoot, ".ralph", "lock"))).resolves.toBe(false);
    await expect(pathExists(join(repoRoot, ".ralph", "runs"))).resolves.toBe(false);
    await expect(pathExists(join(repoRoot, ".ralph", "workspaces"))).resolves.toBe(false);
    expect(await gitCommitCount(repoRoot)).toBe(1);
  });

  it("fails unsupported operator_llm manifests before creating lock, runs, or workspaces", async () => {
    const repoRoot = await initFixtureRepo("numeric", { proposerType: "operator_llm" });
    const service = new RunCycleService();

    await expect(service.run({ repoRoot })).rejects.toMatchObject({
      name: "ManifestLoadError",
      causeValue: {
        issues: [
          expect.objectContaining({
            path: ["proposer", "type"],
          }),
        ],
      },
    } satisfies Partial<ManifestLoadError>);

    await expect(pathExists(join(repoRoot, ".ralph", "lock"))).resolves.toBe(false);
    await expect(pathExists(join(repoRoot, ".ralph", "runs"))).resolves.toBe(false);
    await expect(pathExists(join(repoRoot, ".ralph", "workspaces"))).resolves.toBe(false);
    expect(await gitCommitCount(repoRoot)).toBe(1);
  });

  it("fails unresolved baseline refs before creating lock, runs, or workspaces", async () => {
    const repoRoot = await initFixtureRepo("numeric", { baselineRef: "does-not-exist" });
    const service = new RunCycleService();

    await expect(service.run({ repoRoot })).rejects.toMatchObject({
      name: "ManifestLoadError",
      causeValue: {
        issues: [
          expect.objectContaining({
            path: ["project", "baselineRef"],
          }),
        ],
      },
    } satisfies Partial<ManifestLoadError>);

    await expect(pathExists(join(repoRoot, ".ralph", "lock"))).resolves.toBe(false);
    await expect(pathExists(join(repoRoot, ".ralph", "runs"))).resolves.toBe(false);
    await expect(pathExists(join(repoRoot, ".ralph", "workspaces"))).resolves.toBe(false);
    expect(await gitCommitCount(repoRoot)).toBe(1);
  });

  it("starts workspaces from the requested non-HEAD baseline ref", async () => {
    const repoRoot = await initFixtureRepo("baseline");
    const service = new RunCycleService();

    const result = await service.run({ repoRoot });

    expect(result.status).toBe("accepted");
    expect(result.runResult?.run.workspaceRef).toMatch(/[0-9a-f]{40}/);
    expect(await readFile(join(repoRoot, "docs", "draft.md"), "utf8")).toContain("baseline version");
    expect(await readFile(join(repoRoot, "docs", "draft.md"), "utf8")).not.toContain("head version");
  });

  it("fails fast with owner details when another healthy process already owns the lease", async () => {
    const repoRoot = await initFixtureRepo("numeric");
    await mkdir(join(repoRoot, ".ralph"), { recursive: true });
    await writeFile(
      join(repoRoot, ".ralph", "lock"),
      `${JSON.stringify(
        {
          pid: process.pid,
          token: "active-token",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ttlMs: 10_000,
          graceMs: 5_000,
          owner: {
            runId: "run-0099",
            operation: "run-cycle",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const service = new RunCycleService();
    await expect(service.run({ repoRoot })).rejects.toThrow(/run-0099|active lease|Active lock/i);
  });

  it("commits a resumable accepted run from a persisted patch even when the workspace is gone", async () => {
    const repoRoot = await initFixtureRepo("numeric");
    const storageRoot = join(repoRoot, ".ralph");
    const workspaceManager = new GitWorktreeWorkspaceManager(repoRoot, storageRoot);
    const workspace = await workspaceManager.createWorkspace("candidate-0001", "main");

    await writeFile(join(workspace.workspacePath, "docs", "draft.md"), "Improved draft with stronger structure.\n", "utf8");

    const patchDir = join(storageRoot, "runs", "run-0001", "promotion");
    const patchPath = join(patchDir, "candidate-0001.patch");
    await mkdir(patchDir, { recursive: true });
    await createPromotionPatch(workspace.workspacePath, patchPath);
    await execa("git", ["apply", "--index", "-p2", patchPath], { cwd: repoRoot });
    await workspaceManager.cleanupWorkspace("candidate-0001");

    const runStore = new JsonFileRunStore(join(storageRoot, "runs"));
    const decisionStore = new JsonFileDecisionStore(join(storageRoot, "decisions"));

    await decisionStore.put(makeAcceptedDecisionRecord());
    await runStore.put(makeAcceptedRunRecord(patchPath));

    const service = new RunCycleService();
    const result = await service.run({ repoRoot });

    expect(result.status).toBe("accepted");
    expect(result.runResult?.run.runId).toBe("run-0001");

    const resumedRun = await runStore.get("run-0001");
    const resumedDecision = await decisionStore.get("decision-run-0001");
    const { stdout: headSha } = await execa("git", ["rev-parse", "HEAD"], { cwd: repoRoot });

    expect(resumedRun?.phase).toBe("completed");
    expect(resumedDecision?.commitSha).toBeTruthy();
    expect(headSha.trim()).toBe(resumedDecision?.commitSha);
  });

  it("resumes a committed accepted run by updating frontier state on the same runId", async () => {
    const repoRoot = await initFixtureRepo("numeric");
    const storageRoot = join(repoRoot, ".ralph");
    const runStore = new JsonFileRunStore(join(storageRoot, "runs"));
    const decisionStore = new JsonFileDecisionStore(join(storageRoot, "decisions"));
    const frontierStore = new JsonFileFrontierStore(join(storageRoot, "frontier.json"));
    const commitSha = await gitHeadSha(repoRoot);

    await decisionStore.put(makeAcceptedDecisionRecord({ commitSha }));
    await runStore.put(makeCommittedAcceptedRunRecord());

    const service = new RunCycleService();
    const result = await service.run({ repoRoot });

    expect(result.status).toBe("accepted");
    expect(result.runResult?.run.runId).toBe("run-0001");
    expect(result.runResult?.run.phase).toBe("completed");

    const resumedRun = await runStore.get("run-0001");
    const frontier = await frontierStore.load();

    expect(resumedRun?.phase).toBe("completed");
    expect(frontier).toHaveLength(1);
    expect(frontier[0]?.runId).toBe("run-0001");
    expect(frontier[0]?.commitSha).toBe(commitSha);
  });

  it("resumes a frontier-updated accepted run by cleaning up the workspace on the same runId", async () => {
    const repoRoot = await initFixtureRepo("numeric");
    const storageRoot = join(repoRoot, ".ralph");
    const runStore = new JsonFileRunStore(join(storageRoot, "runs"));
    const decisionStore = new JsonFileDecisionStore(join(storageRoot, "decisions"));
    const frontierStore = new JsonFileFrontierStore(join(storageRoot, "frontier.json"));
    const workspaceManager = new GitWorktreeWorkspaceManager(repoRoot, storageRoot);
    const workspace = await workspaceManager.createWorkspace("candidate-0001", "main");
    const commitSha = await gitHeadSha(repoRoot);

    await decisionStore.put(makeAcceptedDecisionRecord({ commitSha }));
    await runStore.put(makeFrontierUpdatedAcceptedRunRecord(workspace.workspacePath));
    await frontierStore.save([
      {
        frontierId: "frontier-run-0001",
        runId: "run-0001",
        candidateId: "candidate-0001",
        acceptedAt: "2026-03-29T00:00:00.000Z",
        commitSha,
        metrics: {
          quality: {
            metricId: "quality",
            value: 0.7,
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

    const service = new RunCycleService();
    const result = await service.run({ repoRoot });

    expect(result.status).toBe("accepted");
    expect(result.runResult?.run.runId).toBe("run-0001");
    expect(result.runResult?.run.phase).toBe("completed");

    const resumedRun = await runStore.get("run-0001");

    expect(resumedRun?.phase).toBe("completed");
    await expect(pathExists(workspace.workspacePath)).resolves.toBe(false);
  });

  it("retains pareto incumbents and their commit shas when a new accepted run joins the frontier", async () => {
    const repoRoot = await initFixtureRepo("pareto");
    const storageRoot = join(repoRoot, ".ralph");
    const runStore = new JsonFileRunStore(join(storageRoot, "runs"));
    const decisionStore = new JsonFileDecisionStore(join(storageRoot, "decisions"));

    await seedAcceptedHistory(repoRoot, {
      runId: "run-0001",
      candidateId: "candidate-0001",
      decisionId: "decision-run-0001",
      commitSha: "commit-run-0001",
      createdAt: "2026-03-29T00:10:00.000Z",
      metrics: {
        quality: {
          metricId: "quality",
          value: 0.9,
          direction: "maximize",
          details: {},
        },
        novelty: {
          metricId: "novelty",
          value: 0.4,
          direction: "maximize",
          details: {},
        },
      },
    });
    await seedAcceptedHistory(repoRoot, {
      runId: "run-0002",
      candidateId: "candidate-0002",
      decisionId: "decision-run-0002",
      commitSha: "commit-run-0002",
      createdAt: "2026-03-29T00:20:00.000Z",
      metrics: {
        quality: {
          metricId: "quality",
          value: 0.4,
          direction: "maximize",
          details: {},
        },
        novelty: {
          metricId: "novelty",
          value: 0.9,
          direction: "maximize",
          details: {},
        },
      },
    });

    const service = new RunCycleService();
    const result = await service.run({ repoRoot });

    expect(result.status).toBe("accepted");
    const frontierStore = new JsonFileFrontierStore(join(storageRoot, "frontier.json"));
    const frontier = await frontierStore.load();
    const latestRunId = result.runResult?.run.runId;

    expect(latestRunId).toBe("run-0003");
    expect(frontier.map((entry) => ({ runId: entry.runId, commitSha: entry.commitSha }))).toEqual([
      { runId: "run-0001", commitSha: "commit-run-0001" },
      { runId: "run-0002", commitSha: "commit-run-0002" },
      { runId: "run-0003", commitSha: result.runResult?.decision?.commitSha },
    ]);

    const storedRun = await runStore.get("run-0003");
    const storedDecision = await decisionStore.get("decision-run-0003");

    expect(storedRun?.status).toBe("accepted");
    expect(storedDecision?.commitSha).toBe(result.runResult?.decision?.commitSha);
  });

  it("rebuilds the frontier from durable accepted records when the snapshot is missing", async () => {
    const repoRoot = await initFixtureRepo("numeric");
    const storageRoot = join(repoRoot, ".ralph");
    const runStore = new JsonFileRunStore(join(storageRoot, "runs"));
    const decisionStore = new JsonFileDecisionStore(join(storageRoot, "decisions"));

    await decisionStore.put(makeAcceptedDecisionRecord({
      commitSha: await gitHeadSha(repoRoot),
      createdAt: "2026-03-29T00:00:00.000Z",
    }));
    await runStore.put(makeCompletedAcceptedRunRecord({
      metrics: {
        quality: {
          metricId: "quality",
          value: 0.9,
          direction: "maximize",
          details: {},
        },
      },
    }));

    const service = new RunCycleService();
    const result = await service.run({ repoRoot });

    expect(result.status).toBe("rejected");

    const frontierStore = new JsonFileFrontierStore(join(storageRoot, "frontier.json"));
    const frontier = await frontierStore.load();
    expect(frontier).toHaveLength(1);
    expect(frontier[0]?.runId).toBe("run-0001");
  });
});

async function initFixtureRepo(
  mode: "numeric" | "judge" | "graduation" | "history" | "parallel" | "baseline" | "pareto",
  options: {
    baselineRef?: string;
    workspace?: "git" | "copy";
    proposerType?: "command" | "operator_llm";
  } = {},
): Promise<string> {
  const repoRoot = join(tempRoot, `repo-${mode}`);
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, "scripts"), { recursive: true });
  await mkdir(join(repoRoot, "prompts"), { recursive: true });

  await execa("git", ["init"], { cwd: repoRoot });
  await execa("git", ["config", "user.name", "Ralph Research Tests"], { cwd: repoRoot });
  await execa("git", ["config", "user.email", "tests@example.com"], { cwd: repoRoot });

  await writeFile(join(repoRoot, "docs", "draft.md"), "Baseline draft.\n", "utf8");
  await writeFile(
    join(repoRoot, "scripts", "experiment.mjs"),
    [
      'import { cpSync, mkdirSync } from "node:fs";',
      'import { join } from "node:path";',
      'mkdirSync(join(process.cwd(), "out"), { recursive: true });',
      'cpSync(join(process.cwd(), "docs", "draft.md"), join(process.cwd(), "out", "draft.md"));',
      'console.log("experiment complete");',
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(repoRoot, "prompts", "judge.md"), "Return JSON only.\n", "utf8");

  if (mode === "numeric") {
    await writeFile(join(repoRoot, "scripts", "propose.mjs"), buildDefaultProposerScript(), "utf8");
    await writeFile(join(repoRoot, "scripts", "metric.mjs"), 'console.log("0.7");\n', "utf8");
    await writeFile(join(repoRoot, "ralph.yaml"), buildNumericManifest(options), "utf8");
  } else if (mode === "judge") {
    await writeFile(join(repoRoot, "scripts", "propose.mjs"), buildDefaultProposerScript(), "utf8");
    await writeFile(join(repoRoot, "ralph.yaml"), buildJudgeManifest(options), "utf8");
  } else if (mode === "graduation") {
    await writeFile(join(repoRoot, "scripts", "propose.mjs"), buildGraduationProposerScript(), "utf8");
    await writeFile(join(repoRoot, "ralph.yaml"), buildGraduationManifest(options), "utf8");
  } else if (mode === "parallel") {
    await writeFile(join(repoRoot, "scripts", "propose-a.mjs"), buildParallelProposerScript("Candidate A"), "utf8");
    await writeFile(join(repoRoot, "scripts", "propose-b.mjs"), buildParallelProposerScript("Candidate B"), "utf8");
    await writeFile(join(repoRoot, "scripts", "propose-c.mjs"), buildParallelProposerScript("Candidate C"), "utf8");
    await writeFile(join(repoRoot, "scripts", "metric.mjs"), buildParallelMetricScript(), "utf8");
    await writeFile(join(repoRoot, "ralph.yaml"), buildParallelManifest(options), "utf8");
  } else if (mode === "pareto") {
    await writeFile(join(repoRoot, "scripts", "propose.mjs"), buildDefaultProposerScript(), "utf8");
    await writeFile(join(repoRoot, "scripts", "metric-quality.mjs"), 'console.log("0.8");\n', "utf8");
    await writeFile(join(repoRoot, "scripts", "metric-novelty.mjs"), 'console.log("0.8");\n', "utf8");
    await writeFile(join(repoRoot, "ralph.yaml"), buildParetoManifest(options), "utf8");
  } else if (mode === "baseline") {
    await execa("git", ["checkout", "-b", "main"], { cwd: repoRoot });
    await writeFile(join(repoRoot, "scripts", "propose.mjs"), buildBaselineAwareProposerScript(), "utf8");
    await writeFile(join(repoRoot, "scripts", "metric.mjs"), 'console.log("0.7");\n', "utf8");
    await writeFile(join(repoRoot, "ralph.yaml"), buildNumericManifest({ ...options, baselineRef: "baseline-start" }), "utf8");
    await writeFile(join(repoRoot, "docs", "draft.md"), "baseline version\n", "utf8");
    await execa("git", ["add", "."], { cwd: repoRoot });
    await execa("git", ["commit", "-m", "baseline fixture"], { cwd: repoRoot });
    await execa("git", ["tag", "baseline-start"], { cwd: repoRoot });
    await writeFile(join(repoRoot, "docs", "draft.md"), "head version\n", "utf8");
  } else {
    await writeFile(join(repoRoot, "scripts", "propose.mjs"), buildHistoryAwareProposerScript(), "utf8");
    await writeFile(join(repoRoot, "scripts", "metric.mjs"), buildHistoryMetricScript(), "utf8");
    await writeFile(join(repoRoot, "ralph.yaml"), buildHistoryManifest(options), "utf8");
  }

  await execa("git", ["add", "."], { cwd: repoRoot });
  await execa("git", ["commit", "-m", "fixture"], { cwd: repoRoot });
  await execa("git", ["branch", "-M", "main"], { cwd: repoRoot });

  return repoRoot;
}

async function createPromotionPatch(workspacePath: string, patchPath: string): Promise<void> {
  const repoRoot = join(workspacePath, "..", "..", "..");
  const candidateId = workspacePath.split("/").at(-1);
  if (!candidateId) {
    throw new Error("workspace path is missing a candidate id");
  }

  const manager = new GitWorktreeWorkspaceManager(repoRoot, join(repoRoot, ".ralph"));
  const bundle = await manager.preparePromotionBundle(candidateId, {
    excludePaths: ["out/draft.md"],
  });
  await writeFile(patchPath, bundle.patch, "utf8");
}

async function seedAcceptedHistory(
  repoRoot: string,
  input: {
    runId: string;
    candidateId: string;
    decisionId: string;
    commitSha: string;
    createdAt: string;
    metrics: ReturnType<typeof makeAcceptedRunRecord>["metrics"];
  },
): Promise<void> {
  const storageRoot = join(repoRoot, ".ralph");
  const runStore = new JsonFileRunStore(join(storageRoot, "runs"));
  const decisionStore = new JsonFileDecisionStore(join(storageRoot, "decisions"));
  const artifactPath = join(storageRoot, "runs", input.runId, "artifacts", "draft.md");

  await mkdir(join(storageRoot, "runs", input.runId, "artifacts"), { recursive: true });
  await writeFile(artifactPath, `${input.runId} artifact\n`, "utf8");

  await runStore.put({
    ...makeCompletedAcceptedRunRecord(),
    cycle: Number.parseInt(input.runId.replace("run-", ""), 10),
    runId: input.runId,
    candidateId: input.candidateId,
    decisionId: input.decisionId,
    metrics: input.metrics,
    artifacts: [
      {
        id: "draft",
        path: artifactPath,
      },
    ],
  });
  await decisionStore.put({
    ...makeAcceptedDecisionRecord(),
    decisionId: input.decisionId,
    runId: input.runId,
    policyType: "pareto_dominance",
    metricId: "quality",
    createdAt: input.createdAt,
    afterFrontierIds: [`frontier-${input.runId}`],
    commitSha: input.commitSha,
  });
}

function makeAcceptedDecisionRecord(overrides: Partial<ReturnType<typeof baseAcceptedDecisionRecord>> = {}) {
  return {
    ...baseAcceptedDecisionRecord(),
    ...overrides,
  };
}

function baseAcceptedDecisionRecord() {
  return {
    decisionId: "decision-run-0001",
    runId: "run-0001",
    outcome: "accepted" as const,
    actorType: "system" as const,
    policyType: "epsilon_improve",
    metricId: "quality",
    reason: "accepted by test",
    createdAt: "2026-03-29T00:00:00.000Z",
    frontierChanged: true,
    beforeFrontierIds: [],
    afterFrontierIds: ["frontier-run-0001"],
    auditRequired: false,
  };
}

function makeAcceptedRunRecord(patchPath: string) {
  return {
    runId: "run-0001",
    cycle: 1,
    candidateId: "candidate-0001",
    status: "accepted" as const,
    phase: "decision_written" as const,
    pendingAction: "commit_candidate" as const,
    startedAt: "2026-03-29T00:00:00.000Z",
    manifestHash: "manifest-hash",
    workspaceRef: "main",
    proposal: {
      proposerType: "command",
      summary: "Recovered accepted proposal",
      operators: [],
      patchPath,
      changedPaths: ["docs/draft.md"],
      diffLines: 3,
      filesChanged: 1,
      withinBudget: true,
    },
    artifacts: [
      {
        id: "draft",
        path: "out/draft.md",
      },
    ],
    metrics: {
      quality: {
        metricId: "quality",
        value: 0.7,
        direction: "maximize" as const,
        details: {},
      },
    },
    constraints: [],
    decisionId: "decision-run-0001",
    logs: {},
  };
}

function makeCompletedAcceptedRunRecord(
  overrides: Partial<ReturnType<typeof makeAcceptedRunRecord>> = {},
) {
  return {
    ...makeAcceptedRunRecord("/tmp/already-persisted.patch"),
    phase: "completed" as const,
    pendingAction: "none" as const,
    endedAt: "2026-03-29T00:10:00.000Z",
    ...overrides,
  };
}

function makeCommittedAcceptedRunRecord(
  overrides: Partial<ReturnType<typeof makeAcceptedRunRecord>> = {},
) {
  return {
    ...makeAcceptedRunRecord("/tmp/already-persisted.patch"),
    phase: "committed" as const,
    pendingAction: "update_frontier" as const,
    ...overrides,
  };
}

function makeFrontierUpdatedAcceptedRunRecord(
  workspacePath: string,
  overrides: Partial<ReturnType<typeof makeAcceptedRunRecord>> = {},
) {
  return {
    ...makeAcceptedRunRecord("/tmp/already-persisted.patch"),
    phase: "frontier_updated" as const,
    pendingAction: "cleanup_workspace" as const,
    workspacePath,
    ...overrides,
  };
}

async function gitHeadSha(repoRoot: string): Promise<string> {
  const { stdout } = await execa("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  return stdout.trim();
}

function buildDefaultProposerScript(): string {
  return [
    'import { writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'writeFileSync(join(process.cwd(), "docs", "draft.md"), "Improved draft with stronger structure.\\n", "utf8");',
    'console.log("proposal complete");',
  ].join("\n");
}

function buildNumericManifest(options: { baselineRef?: string; workspace?: "git" | "copy"; proposerType?: "command" | "operator_llm" } = {}): string {
  const proposerLines =
    options.proposerType === "operator_llm"
      ? [
          "proposer:",
          "  type: operator_llm",
          "  model: fake-model",
          "  prompt: prompts/judge.md",
          "  operators:",
          "    - strengthen_claim_evidence",
        ]
      : [
          "proposer:",
          "  type: command",
          '  command: "node scripts/propose.mjs"',
        ];
  return [
    'schemaVersion: "0.1"',
    "project:",
    "  name: service-numeric",
    "  artifact: manuscript",
    `  baselineRef: ${options.baselineRef ?? "main"}`,
    `  workspace: ${options.workspace ?? "git"}`,
    "scope:",
    "  allowedGlobs:",
    '    - "**/*.md"',
    "  maxFilesChanged: 2",
    "  maxLineDelta: 20",
    ...proposerLines,
    "experiment:",
    "  run:",
    '    command: "node scripts/experiment.mjs"',
    "  outputs:",
    "    - id: draft",
    "      path: out/draft.md",
    "metrics:",
    "  catalog:",
    "    - id: quality",
    "      kind: numeric",
    "      direction: maximize",
    "      extractor:",
    "        type: command",
    '        command: "node scripts/metric.mjs"',
    "        parser: plain_number",
    "constraints: []",
    "frontier:",
    "  strategy: single_best",
    "  primaryMetric: quality",
    "ratchet:",
    "  type: epsilon_improve",
    "  metric: quality",
    "  epsilon: 0",
    "storage:",
    "  root: .ralph",
    "",
  ].join("\n");
}

function buildJsonMetricManifest(options: { baselineRef?: string; workspace?: "git" | "copy" } = {}): string {
  return [
    'schemaVersion: "0.1"',
    "project:",
    "  name: service-json-metric",
    "  artifact: manuscript",
    `  baselineRef: ${options.baselineRef ?? "main"}`,
    `  workspace: ${options.workspace ?? "git"}`,
    "scope:",
    "  allowedGlobs:",
    '    - "**/*.md"',
    "  maxFilesChanged: 2",
    "  maxLineDelta: 20",
    "proposer:",
    "  type: command",
    '  command: "node scripts/propose.mjs"',
    "experiment:",
    "  run:",
    '    command: "node scripts/experiment.mjs"',
    "  outputs:",
    "    - id: draft",
    "      path: out/draft.md",
    "metrics:",
    "  catalog:",
    "    - id: quality",
    "      kind: numeric",
    "      direction: maximize",
    "      extractor:",
    "        type: command",
    '        command: "node scripts/metric.mjs"',
    "        parser: json_path",
    "        valuePath: $.value",
    "constraints: []",
    "frontier:",
    "  strategy: single_best",
    "  primaryMetric: quality",
    "ratchet:",
    "  type: epsilon_improve",
    "  metric: quality",
    "  epsilon: 0",
    "storage:",
    "  root: .ralph",
    "",
  ].join("\n");
}

function buildJudgeManifest(options: { baselineRef?: string; workspace?: "git" | "copy" } = {}): string {
  return [
    'schemaVersion: "0.1"',
    "project:",
    "  name: service-judge",
    "  artifact: manuscript",
    `  baselineRef: ${options.baselineRef ?? "main"}`,
    `  workspace: ${options.workspace ?? "git"}`,
    "scope:",
    "  allowedGlobs:",
    '    - "**/*.md"',
    "  maxFilesChanged: 2",
    "  maxLineDelta: 20",
    "proposer:",
    "  type: command",
    '  command: "node scripts/propose.mjs"',
    "experiment:",
    "  run:",
    '    command: "node scripts/experiment.mjs"',
    "  outputs:",
    "    - id: draft",
    "      path: out/draft.md",
    "judgePacks:",
    "  - id: writing-pack",
    "    mode: pairwise",
    "    blindPairwise: true",
    "    orderRandomized: true",
    "    repeats: 5",
    "    aggregation: majority_vote",
    "    judges:",
    "      - model: fake-model",
    "        weight: 1",
    "    lowConfidenceThreshold: 0.75",
    "    audit:",
    "      sampleRate: 0",
    "      freezeAutoAcceptIfAnchorFails: true",
    "metrics:",
    "  catalog:",
    "    - id: paper_quality",
    "      kind: llm_score",
    "      direction: maximize",
    "      extractor:",
    "        type: llm_judge",
    "        judgePack: writing-pack",
    "        prompt: prompts/judge.md",
    "        mode: pairwise",
    "        compareAgainst: frontier.best",
    "        inputs: {}",
    "        outputKey: score",
    "constraints: []",
    "frontier:",
    "  strategy: single_best",
    "  primaryMetric: paper_quality",
    "ratchet:",
    "  type: approval_gate",
    "  metric: paper_quality",
    "  minConfidence: 0.75",
    "storage:",
    "  root: .ralph",
    "",
  ].join("\n");
}

function buildGraduationManifest(options: { baselineRef?: string; workspace?: "git" | "copy" } = {}): string {
  return [
    'schemaVersion: "0.1"',
    "project:",
    "  name: service-graduation",
    "  artifact: manuscript",
    `  baselineRef: ${options.baselineRef ?? "main"}`,
    `  workspace: ${options.workspace ?? "git"}`,
    "scope:",
    "  allowedGlobs:",
    '    - "**/*.md"',
    "  maxFilesChanged: 2",
    "  maxLineDelta: 20",
    "proposer:",
    "  type: command",
    '  command: "node scripts/propose.mjs"',
    "experiment:",
    "  run:",
    '    command: "node scripts/experiment.mjs"',
    "  outputs:",
    "    - id: draft",
    "      path: out/draft.md",
    "judgePacks:",
    "  - id: graduation-pack",
    "    mode: absolute",
    "    blindPairwise: true",
    "    orderRandomized: true",
    "    repeats: 5",
    "    aggregation: mean",
    "    judges:",
    "      - model: fake-model",
    "        weight: 1",
    "    lowConfidenceThreshold: 0.75",
    "    audit:",
    "      sampleRate: 0",
    "      freezeAutoAcceptIfAnchorFails: true",
    "metrics:",
    "  catalog:",
    "    - id: feasibility",
    "      kind: llm_score",
    "      direction: maximize",
    "      extractor:",
    "        type: llm_judge",
    "        judgePack: graduation-pack",
    "        prompt: prompts/judge.md",
    "        mode: absolute",
    "        compareAgainst: none",
    "        inputs:",
    "          candidate: out/draft.md",
    "        outputKey: score",
    "constraints: []",
    "frontier:",
    "  strategy: single_best",
    "  primaryMetric: feasibility",
    "ratchet:",
    "  type: approval_gate",
    "  metric: feasibility",
    "  minConfidence: 0.75",
    "  graduation:",
    "    consecutiveAccepts: 2",
    "    epsilon: 0.05",
    "storage:",
    "  root: .ralph",
    "",
  ].join("\n");
}

function buildGraduationProposerScript(): string {
  return [
    'import { readFileSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'const draftPath = join(process.cwd(), "docs", "draft.md");',
    'const current = readFileSync(draftPath, "utf8");',
    'let next = "Draft v1.\\n";',
    'if (current.includes("v1")) next = "Draft v2.\\n";',
    'if (current.includes("v2")) next = "Draft v3.\\n";',
    'writeFileSync(draftPath, next, "utf8");',
    'console.log("proposal complete");',
  ].join("\n");
}

function buildHistoryManifest(options: { baselineRef?: string; workspace?: "git" | "copy" } = {}): string {
  return [
    'schemaVersion: "0.1"',
    "project:",
    "  name: service-history",
    "  artifact: manuscript",
    `  baselineRef: ${options.baselineRef ?? "main"}`,
    `  workspace: ${options.workspace ?? "git"}`,
    "scope:",
    "  allowedGlobs:",
    '    - "**/*.md"',
    "  maxFilesChanged: 2",
    "  maxLineDelta: 200",
    "proposer:",
    "  type: command",
    '  command: "node scripts/propose.mjs"',
    "  history:",
    "    enabled: true",
    "    maxRuns: 3",
    "experiment:",
    "  run:",
    '    command: "node scripts/experiment.mjs"',
    "  outputs:",
    "    - id: draft",
    "      path: out/draft.md",
    "metrics:",
    "  catalog:",
    "    - id: quality",
    "      kind: numeric",
    "      direction: maximize",
    "      extractor:",
    "        type: command",
    '        command: "node scripts/metric.mjs"',
    "        parser: plain_number",
    "constraints: []",
    "frontier:",
    "  strategy: single_best",
    "  primaryMetric: quality",
    "ratchet:",
    "  type: epsilon_improve",
    "  metric: quality",
    "  epsilon: 0",
    "storage:",
    "  root: .ralph",
    "",
  ].join("\n");
}

function buildHistoryAwareProposerScript(): string {
  return [
    'import { writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'const history = process.env.RRX_HISTORY_SUMMARY ?? "missing";',
    'const hasPriorRun = history.includes("run-0001");',
    'const body = hasPriorRun',
    '  ? `Second improvement.\\n\\nHistory seen:\\n${history}`',
    '  : `First improvement.\\n\\nHistory seen:\\n${history}`;',
    'writeFileSync(join(process.cwd(), "docs", "draft.md"), body, "utf8");',
    'console.log("proposal complete");',
  ].join("\n");
}

function buildBaselineAwareProposerScript(): string {
  return [
    'import { readFileSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'const draftPath = join(process.cwd(), "docs", "draft.md");',
    'const current = readFileSync(draftPath, "utf8").trim();',
    'writeFileSync(draftPath, `from ${current}\\nImproved draft with stronger structure.\\n`, "utf8");',
    'console.log("proposal complete");',
  ].join("\n");
}

function buildHistoryMetricScript(): string {
  return [
    'import { readFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'const draft = readFileSync(join(process.cwd(), "out", "draft.md"), "utf8");',
    'console.log(draft.includes("run-0001") ? "0.9" : "0.7");',
  ].join("\n");
}

function buildParallelProposerScript(label: string): string {
  return [
    'import { writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    `writeFileSync(join(process.cwd(), "docs", "draft.md"), "${label}\\n", "utf8");`,
    'console.log("proposal complete");',
  ].join("\n");
}

function buildParallelMetricScript(): string {
  return [
    'import { readFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'const draft = readFileSync(join(process.cwd(), "out", "draft.md"), "utf8");',
    'if (draft.includes("Candidate C")) console.log("0.9");',
    'else if (draft.includes("Candidate B")) console.log("0.6");',
    'else console.log("0.4");',
  ].join("\n");
}

function buildParallelManifest(options: { baselineRef?: string; workspace?: "git" | "copy" } = {}): string {
  return [
    'schemaVersion: "0.1"',
    "project:",
    "  name: service-parallel",
    "  artifact: manuscript",
    `  baselineRef: ${options.baselineRef ?? "main"}`,
    `  workspace: ${options.workspace ?? "git"}`,
    "scope:",
    "  allowedGlobs:",
    '    - "**/*.md"',
    "  maxFilesChanged: 2",
    "  maxLineDelta: 20",
    "proposer:",
    "  type: parallel",
    "  pickBest: highest_metric",
    "  strategies:",
    "    - type: command",
    '      command: "node scripts/propose-a.mjs"',
    "    - type: command",
    '      command: "node scripts/propose-b.mjs"',
    "    - type: command",
    '      command: "node scripts/propose-c.mjs"',
    "experiment:",
    "  run:",
    '    command: "node scripts/experiment.mjs"',
    "  outputs:",
    "    - id: draft",
    "      path: out/draft.md",
    "metrics:",
    "  catalog:",
    "    - id: quality",
    "      kind: numeric",
    "      direction: maximize",
    "      extractor:",
    "        type: command",
    '        command: "node scripts/metric.mjs"',
    "        parser: plain_number",
    "constraints: []",
    "frontier:",
    "  strategy: single_best",
    "  primaryMetric: quality",
    "ratchet:",
    "  type: epsilon_improve",
    "  metric: quality",
    "  epsilon: 0",
    "storage:",
    "  root: .ralph",
    "",
  ].join("\n");
}

function buildParetoManifest(options: { baselineRef?: string; workspace?: "git" | "copy" } = {}): string {
  return [
    'schemaVersion: "0.1"',
    "project:",
    "  name: service-pareto",
    "  artifact: manuscript",
    `  baselineRef: ${options.baselineRef ?? "main"}`,
    `  workspace: ${options.workspace ?? "git"}`,
    "scope:",
    "  allowedGlobs:",
    '    - "**/*.md"',
    "  maxFilesChanged: 2",
    "  maxLineDelta: 20",
    "proposer:",
    "  type: command",
    '  command: "node scripts/propose.mjs"',
    "experiment:",
    "  run:",
    '    command: "node scripts/experiment.mjs"',
    "  outputs:",
    "    - id: draft",
    "      path: out/draft.md",
    "metrics:",
    "  catalog:",
    "    - id: quality",
    "      kind: numeric",
    "      direction: maximize",
    "      extractor:",
    "        type: command",
    '        command: "node scripts/metric-quality.mjs"',
    "        parser: plain_number",
    "    - id: novelty",
    "      kind: numeric",
    "      direction: maximize",
    "      extractor:",
    "        type: command",
    '        command: "node scripts/metric-novelty.mjs"',
    "        parser: plain_number",
    "constraints: []",
    "frontier:",
    "  strategy: pareto",
    "  objectives:",
    "    - metric: quality",
    "      epsilon: 0",
    "    - metric: novelty",
    "      epsilon: 0",
    "  tieBreaker: none",
    "ratchet:",
    "  type: pareto_dominance",
    "storage:",
    "  root: .ralph",
    "",
  ].join("\n");
}

function createSequentialJudgeProvider(responses: JudgeResponse[]): JudgeProvider {
  let index = 0;
  return {
    async evaluate(_request: JudgeRequest): Promise<JudgeResponse> {
      const response = responses[index];
      index += 1;
      if (!response) {
        throw new Error("judge response sequence exhausted");
      }
      return response;
    },
  };
}

function pairwise(winner: "candidate" | "incumbent" | "tie", confidence?: number): JudgeResponse {
  return {
    mode: "pairwise",
    winner,
    rationale: `${winner} wins`,
    raw: JSON.stringify({ winner, confidence }),
    ...(confidence === undefined ? {} : { confidence }),
  };
}

function absolute(score: number, confidence?: number): JudgeResponse {
  return {
    mode: "absolute",
    score,
    rationale: `score ${score}`,
    raw: JSON.stringify({ score, confidence }),
    ...(confidence === undefined ? {} : { confidence }),
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function gitCommitCount(repoRoot: string): Promise<number> {
  const { stdout } = await execa("git", ["rev-list", "--count", "HEAD"], { cwd: repoRoot });
  return Number.parseInt(stdout.trim(), 10);
}
