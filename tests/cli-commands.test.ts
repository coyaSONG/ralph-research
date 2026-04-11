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
import { GitWorktreeWorkspaceManager } from "../src/core/engine/workspace-manager.js";
import { runAcceptCommand } from "../src/cli/commands/accept.js";
import { runDoctorCommand } from "../src/cli/commands/doctor.js";
import { runFrontierCommand } from "../src/cli/commands/frontier.js";
import { runInspectCommand } from "../src/cli/commands/inspect.js";
import { runRejectCommand } from "../src/cli/commands/reject.js";
import { runRunCommand } from "../src/cli/commands/run.js";
import { runStatusCommand } from "../src/cli/commands/status.js";
import { runValidateCommand } from "../src/cli/commands/validate.js";
import { researchSessionRecordSchema, type ResearchSessionRecord } from "../src/core/model/research-session.js";

let tempRoot = "";
let originalCwd = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-cli-"));
  originalCwd = process.cwd();
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("CLI commands", () => {
  it("runs a cycle and returns JSON output", async () => {
    const repoRoot = await initFixtureRepo("numeric");
    process.chdir(repoRoot);

    const io = createCapturingIo();
    const exitCode = await runRunCommand({ cycles: 1, json: true }, io);

    expect(exitCode).toBe(0);
    const payload = JSON.parse(io.stdoutText());
    expect(payload.ok).toBe(true);
    expect(payload.results[0]?.status).toBe("accepted");
  });

  it("reports pending human runs in status output", async () => {
    const repoRoot = await initFixtureRepo("judge");
    process.chdir(repoRoot);

    const service = new RunCycleService({
      judgeProvider: createSequentialJudgeProvider([
        pairwise("candidate", 0.2),
        pairwise("candidate", 0.3),
        pairwise("candidate", 0.4),
        pairwise("incumbent", 0.3),
        pairwise("incumbent", 0.4),
      ]),
    });
    await service.run({ repoRoot });

    const io = createCapturingIo();
    const exitCode = await runStatusCommand({ json: true }, io);

    expect(exitCode).toBe(0);
    const payload = JSON.parse(io.stdoutText());
    expect(payload.pendingHumanRuns).toHaveLength(1);
    expect(payload.pendingHumanRuns[0]?.status).toBe("needs_human");
  });

  it("shows the current frontier in frontier output", async () => {
    const repoRoot = await initFixtureRepo("numeric");
    process.chdir(repoRoot);

    const service = new RunCycleService();
    await service.run({ repoRoot });

    const io = createCapturingIo();
    const exitCode = await runFrontierCommand({ json: true }, io);

    expect(exitCode).toBe(0);
    const payload = JSON.parse(io.stdoutText());
    expect(payload.frontier).toHaveLength(1);
    expect(payload.frontier[0]?.metrics.quality.value).toBeCloseTo(0.7);
  });

  it("rebuilds frontier output when the snapshot is missing", async () => {
    const repoRoot = await initFixtureRepo("numeric");
    process.chdir(repoRoot);

    const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
    const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".ralph", "decisions"));
    await runStore.put(makeAcceptedFrontierRunRecord());
    await decisionStore.put(makeAcceptedFrontierDecisionRecord());

    const io = createCapturingIo();
    const exitCode = await runFrontierCommand({ json: true }, io);

    expect(exitCode).toBe(0);
    const payload = JSON.parse(io.stdoutText());
    expect(payload.frontier).toHaveLength(1);
    expect(payload.frontier[0]?.runId).toBe("run-0001");
  });

  it("shows decision reason, metric delta, and judge rationale in inspect output", async () => {
    const repoRoot = await initFixtureRepo("judge");
    process.chdir(repoRoot);
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
        pairwise("candidate", 1),
        pairwise("candidate", 1),
        pairwise("candidate", 1),
        pairwise("incumbent", 1),
        pairwise("incumbent", 1),
      ]),
    });
    await service.run({ repoRoot });

    const io = createCapturingIo();
    const exitCode = await runInspectCommand("run-0001", { json: true }, io);

    expect(exitCode).toBe(0);
    const payload = JSON.parse(io.stdoutText());
    expect(payload.explainability.decisionReason).toContain("candidate");
    expect(payload.explainability.metricDeltas[0]?.metricId).toBe("paper_quality");
    expect(payload.explainability.metricDeltas[0]?.delta).toBeGreaterThan(0);
    expect(payload.explainability.judgeRationales[0]?.rationale.length).toBeGreaterThan(0);
    expect(payload.explainability.diffSummary.changedPaths).toContain("docs/draft.md");
  });

  it("accepts a pending human run and keeps commitSha and frontier state consistent", async () => {
    const repoRoot = await initFixtureRepo("judge");
    process.chdir(repoRoot);
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
    await service.run({ repoRoot });

    const io = createCapturingIo();
    const exitCode = await runAcceptCommand(
      "run-0001",
      {
        by: "reviewer",
        note: "looks good",
        json: true,
      },
      io,
    );

    expect(exitCode).toBe(0);

    const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".ralph", "decisions"));
    const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
    const decision = await decisionStore.get("decision-run-0001");
    const run = await runStore.get("run-0001");
    const frontier = await frontierStore.load();
    const { stdout: headSha } = await execa("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
    const { stdout: committedPaths } = await execa("git", ["show", "--name-only", "--pretty=", "HEAD"], { cwd: repoRoot });
    const statusIo = createCapturingIo();
    const frontierIo = createCapturingIo();
    const inspectIo = createCapturingIo();

    expect(decision?.outcome).toBe("accepted");
    expect(decision?.commitSha).toBeTruthy();
    expect(decision?.reason).toContain("human accepted");
    expect(run?.status).toBe("accepted");
    expect(frontier).toHaveLength(1);
    expect(frontier[0]?.runId).toBe("run-0001");
    expect(frontier[0]?.commitSha).toBe(decision?.commitSha);
    expect(headSha.trim()).toBe(decision?.commitSha);
    expect(committedPaths.trim().split("\n")).toEqual(["docs/draft.md"]);
    expect(run?.proposal.patchPath).toBeTruthy();
    await expect(pathExists(run?.proposal.patchPath ?? "")).resolves.toBe(true);

    expect(await runStatusCommand({ json: true }, statusIo)).toBe(0);
    expect(await runFrontierCommand({ json: true }, frontierIo)).toBe(0);
    expect(await runInspectCommand("run-0001", { json: true }, inspectIo)).toBe(0);

    const statusPayload = JSON.parse(statusIo.stdoutText());
    const frontierPayload = JSON.parse(frontierIo.stdoutText());
    const inspectPayload = JSON.parse(inspectIo.stdoutText());

    expect(statusPayload.latestRun.status).toBe("accepted");
    expect(statusPayload.pendingHumanRuns).toHaveLength(0);
    expect(frontierPayload.frontier).toHaveLength(1);
    expect(frontierPayload.frontier[0]?.runId).toBe("run-0001");
    expect(inspectPayload.run.status).toBe("accepted");
    expect(inspectPayload.decision.outcome).toBe("accepted");
    expect(inspectPayload.frontier[0]?.runId).toBe("run-0001");
  });

  it("keeps legacy run, decision, and frontier behavior authoritative even when resumable sessions exist", async () => {
    const repoRoot = await initFixtureRepo("judge");
    process.chdir(repoRoot);
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
    await persistResearchSession(repoRoot, {
      sessionId: "session-legacy-ignored",
      status: "awaiting_resume",
      stopCondition: {
        type: "operator_stop",
        note: "resume later",
      },
      progress: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-session-002",
        latestDecisionId: "decision-session-002",
        latestFrontierIds: ["frontier-session-002"],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
        lastCheckpointAt: "2026-04-12T00:02:00.000Z",
        lastSignals: {
          cycle: 2,
          outcome: "accepted",
          changedFileCount: 1,
          diffLineCount: 12,
          repeatedDiff: false,
          meaningfulProgress: true,
          insufficientEvidence: false,
          agentTieBreakerUsed: false,
          newArtifacts: ["reports/holdout-cycle-2.json"],
          reasons: ["Future holdout top-3 score improved."],
        },
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 3,
        requiresUserConfirmation: true,
        checkpointRunId: "run-session-002",
        checkpointDecisionId: "decision-session-002",
        interruptionDetectedAt: "2026-04-12T00:02:30.000Z",
      },
      updatedAt: "2026-04-12T00:02:00.000Z",
    });

    const service = new RunCycleService({
      judgeProvider: createSequentialJudgeProvider([
        pairwise("candidate", 0.2),
        pairwise("candidate", 0.3),
        pairwise("candidate", 0.4),
        pairwise("incumbent", 0.3),
        pairwise("incumbent", 0.4),
      ]),
    });
    await service.run({ repoRoot });

    const acceptIo = createCapturingIo();
    const statusIo = createCapturingIo();
    const frontierIo = createCapturingIo();
    const inspectIo = createCapturingIo();

    expect(
      await runAcceptCommand(
        "run-0001",
        {
          by: "reviewer",
          note: "looks good",
          json: true,
        },
        acceptIo,
      ),
    ).toBe(0);
    expect(await runStatusCommand({ json: true }, statusIo)).toBe(0);
    expect(await runFrontierCommand({ json: true }, frontierIo)).toBe(0);
    expect(await runInspectCommand("run-0001", { json: true }, inspectIo)).toBe(0);

    const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
    const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".ralph", "decisions"));
    const acceptedRun = await runStore.get("run-0001");
    const acceptedDecision = await decisionStore.get("decision-run-0001");
    const persistedFrontier = await frontierStore.load();
    const persistedSessionPath = join(repoRoot, ".ralph", "sessions", "session-legacy-ignored", "session.json");
    await expect(access(persistedSessionPath)).resolves.toBeUndefined();
    const persistedSession = researchSessionRecordSchema.parse(
      JSON.parse(await readFile(persistedSessionPath, "utf8")),
    );
    const statusPayload = JSON.parse(statusIo.stdoutText());
    const frontierPayload = JSON.parse(frontierIo.stdoutText());
    const inspectPayload = JSON.parse(inspectIo.stdoutText());

    expect(acceptedRun?.status).toBe("accepted");
    expect(acceptedDecision?.outcome).toBe("accepted");
    expect(persistedFrontier).toHaveLength(1);
    expect(persistedFrontier[0]?.runId).toBe("run-0001");
    expect(statusPayload.latestRun.runId).toBe("run-0001");
    expect(statusPayload.pendingHumanRuns).toHaveLength(0);
    expect(frontierPayload.frontier.map((entry: { runId: string }) => entry.runId)).toEqual(["run-0001"]);
    expect(inspectPayload.decision.decisionId).toBe("decision-run-0001");
    expect(inspectPayload.frontier.map((entry: { runId: string }) => entry.runId)).toEqual(["run-0001"]);
    expect(persistedSession.status).toBe("awaiting_resume");
    expect(persistedSession.resume.checkpointRunId).toBe("run-session-002");
  });

  it("manually accepts a pareto-reviewed run without collapsing incumbent frontier entries", async () => {
    const repoRoot = await initFixtureRepo("pareto");
    process.chdir(repoRoot);

    await seedAcceptedHistory(repoRoot, {
      runId: "run-incumbent-a",
      candidateId: "candidate-incumbent-a",
      decisionId: "decision-run-incumbent-a",
      metrics: {
        quality: makeMetricResult("quality", 0.9),
        novelty: makeMetricResult("novelty", 0.4),
      },
    });
    await seedAcceptedHistory(repoRoot, {
      runId: "run-incumbent-b",
      candidateId: "candidate-incumbent-b",
      decisionId: "decision-run-incumbent-b",
      metrics: {
        quality: makeMetricResult("quality", 0.4),
        novelty: makeMetricResult("novelty", 0.9),
      },
    });

    await seedPendingHumanRun(repoRoot, {
      runId: "run-0003",
      candidateId: "candidate-0003",
      decisionId: "decision-run-0003",
      metricId: "quality",
      policyType: "pareto_dominance",
      metrics: {
        quality: makeMetricResult("quality", 0.8),
        novelty: makeMetricResult("novelty", 0.8),
      },
    });

    const io = createCapturingIo();
    const exitCode = await runAcceptCommand(
      "run-0003",
      {
        by: "reviewer",
        note: "pareto keeps all non-dominated entries",
        json: true,
      },
      io,
    );

    expect(exitCode).toBe(0);

    const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".ralph", "decisions"));
    const frontierStore = new JsonFileFrontierStore(join(repoRoot, ".ralph", "frontier.json"));
    const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
    const decision = await decisionStore.get("decision-run-0003");
    const run = await runStore.get("run-0003");
    const frontier = await frontierStore.load();

    expect(decision?.outcome).toBe("accepted");
    expect(decision?.frontierChanged).toBe(true);
    expect(decision?.beforeFrontierIds).toEqual([
      "frontier-run-incumbent-a",
      "frontier-run-incumbent-b",
    ]);
    expect(decision?.afterFrontierIds).toEqual([
      "frontier-run-incumbent-a",
      "frontier-run-incumbent-b",
      "frontier-run-0003",
    ]);
    expect(run?.status).toBe("accepted");
    expect(run?.proposal.patchPath).toBeTruthy();
    await expect(pathExists(run?.proposal.patchPath ?? "")).resolves.toBe(true);
    expect(frontier.map((entry) => entry.runId)).toEqual([
      "run-incumbent-a",
      "run-incumbent-b",
      "run-0003",
    ]);
  });

  it("keeps status, frontier, inspect, and cleanup consistent after manual reject", async () => {
    const repoRoot = await initFixtureRepo("judge");
    process.chdir(repoRoot);

    await seedAcceptedHistory(repoRoot, {
      runId: "run-0001",
      candidateId: "candidate-0001",
      decisionId: "decision-run-0001",
      metricId: "paper_quality",
      metrics: {
        paper_quality: makeMetricResult("paper_quality", 0.7),
      },
    });
    const pending = await seedPendingHumanRun(repoRoot, {
      runId: "run-0002",
      candidateId: "candidate-0002",
      decisionId: "decision-run-0002",
      metricId: "paper_quality",
      policyType: "approval_gate",
      metrics: {
        paper_quality: makeMetricResult("paper_quality", 0.65, 0.6),
      },
    });

    const rejectIo = createCapturingIo();
    const statusIo = createCapturingIo();
    const frontierIo = createCapturingIo();
    const inspectIo = createCapturingIo();

    expect(
      await runRejectCommand(
        "run-0002",
        {
          by: "reviewer",
          note: "not enough evidence",
          json: true,
        },
        rejectIo,
      ),
    ).toBe(0);
    expect(await runStatusCommand({ json: true }, statusIo)).toBe(0);
    expect(await runFrontierCommand({ json: true }, frontierIo)).toBe(0);
    expect(await runInspectCommand("run-0002", { json: true }, inspectIo)).toBe(0);

    const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".ralph", "decisions"));
    const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
    const decision = await decisionStore.get("decision-run-0002");
    const run = await runStore.get("run-0002");
    const statusPayload = JSON.parse(statusIo.stdoutText());
    const frontierPayload = JSON.parse(frontierIo.stdoutText());
    const inspectPayload = JSON.parse(inspectIo.stdoutText());

    expect(decision?.outcome).toBe("rejected");
    expect(decision?.frontierChanged).toBe(false);
    expect(decision?.beforeFrontierIds).toEqual(["frontier-run-0001"]);
    expect(decision?.afterFrontierIds).toEqual(["frontier-run-0001"]);
    expect(run?.status).toBe("rejected");
    expect(statusPayload.latestRun.status).toBe("rejected");
    expect(statusPayload.pendingHumanRuns).toHaveLength(0);
    expect(frontierPayload.frontier.map((entry: { runId: string }) => entry.runId)).toEqual(["run-0001"]);
    expect(inspectPayload.run.status).toBe("rejected");
    expect(inspectPayload.decision.outcome).toBe("rejected");
    expect(inspectPayload.frontier.map((entry: { runId: string }) => entry.runId)).toEqual(["run-0001"]);
    await expect(pathExists(pending.workspacePath)).resolves.toBe(false);
  });

  it("reports doctor success for executable manifests and blocks unsupported workspace manifests", async () => {
    const executableRepo = await initFixtureRepo("numeric");
    process.chdir(executableRepo);

    const executableIo = createCapturingIo();
    const executableExitCode = await runDoctorCommand({ json: true }, executableIo);

    expect(executableExitCode).toBe(0);
    expect(JSON.parse(executableIo.stdoutText())).toMatchObject({
      ok: true,
      executable: true,
    });

    const blockedRepo = await initFixtureRepo("numeric", { workspace: "copy" });
    process.chdir(blockedRepo);

    const blockedIo = createCapturingIo();
    const blockedExitCode = await runDoctorCommand({ json: true }, blockedIo);

    expect(blockedExitCode).toBe(1);
    expect(JSON.parse(blockedIo.stderrText())).toMatchObject({
      ok: false,
      executable: false,
      details: {
        issues: [
          expect.objectContaining({
            path: ["project", "workspace"],
          }),
        ],
      },
    });
  });

  it("keeps validate, doctor, and run aligned on unsupported manifest/runtime combinations", async () => {
    const cases = [
      {
        name: "workspace copy",
        createRepo: () => initFixtureRepo("numeric", { workspace: "copy" }),
        expectedIssuePath: ["project", "workspace"],
      },
      {
        name: "operator_llm proposer",
        createRepo: () => initFixtureRepo("numeric", { proposerType: "operator_llm" }),
        expectedIssuePath: ["proposer", "type"],
      },
    ];

    for (const testCase of cases) {
      const repoRoot = await testCase.createRepo();
      process.chdir(repoRoot);

      const validateIo = createCapturingIo();
      const doctorIo = createCapturingIo();
      const runIo = createCapturingIo();

      expect(await runValidateCommand({ path: "ralph.yaml", json: true }, validateIo)).toBe(1);
      expect(await runDoctorCommand({ json: true }, doctorIo)).toBe(1);
      expect(await runRunCommand({ cycles: 1, json: true }, runIo)).toBe(1);

      const validatePayload = JSON.parse(validateIo.stderrText());
      const doctorPayload = JSON.parse(doctorIo.stderrText());
      const runPayload = JSON.parse(runIo.stderrText());

      expect(validatePayload.details.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: testCase.expectedIssuePath,
          }),
        ]),
      );
      expect(doctorPayload.details.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: testCase.expectedIssuePath,
          }),
        ]),
      );
      expect(runPayload.error).toContain("Manifest admission failed");
    }
  });

  it("makes run abort unsupported manifests without side effects", async () => {
    const repoRoot = await initFixtureRepo("numeric", { workspace: "copy" });
    process.chdir(repoRoot);

    const io = createCapturingIo();
    const exitCode = await runRunCommand({ cycles: 1, json: true }, io);

    expect(exitCode).toBe(1);
    expect(JSON.parse(io.stderrText())).toMatchObject({
      ok: false,
      error: expect.stringContaining("Manifest admission failed"),
    });
    await expect(pathExists(join(repoRoot, ".ralph", "lock"))).resolves.toBe(false);
    await expect(pathExists(join(repoRoot, ".ralph", "runs"))).resolves.toBe(false);
    await expect(pathExists(join(repoRoot, ".ralph", "workspaces"))).resolves.toBe(false);
  });

  it("makes doctor and run agree on unresolved baseline refs", async () => {
    const repoRoot = await initFixtureRepo("numeric", { baselineRef: "does-not-exist" });
    process.chdir(repoRoot);

    const doctorIo = createCapturingIo();
    const doctorExitCode = await runDoctorCommand({ json: true }, doctorIo);
    expect(doctorExitCode).toBe(1);
    expect(JSON.parse(doctorIo.stderrText())).toMatchObject({
      ok: false,
      executable: false,
      details: {
        issues: [
          expect.objectContaining({
            path: ["project", "baselineRef"],
          }),
        ],
      },
    });

    const runIo = createCapturingIo();
    const runExitCode = await runRunCommand({ cycles: 1, json: true }, runIo);
    expect(runExitCode).toBe(1);
    expect(JSON.parse(runIo.stderrText())).toMatchObject({
      ok: false,
      error: expect.stringContaining("Manifest admission failed"),
    });
    await expect(pathExists(join(repoRoot, ".ralph", "lock"))).resolves.toBe(false);
    await expect(pathExists(join(repoRoot, ".ralph", "runs"))).resolves.toBe(false);
    await expect(pathExists(join(repoRoot, ".ralph", "workspaces"))).resolves.toBe(false);
  });
});

function createCapturingIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout: (message: string) => {
      stdout.push(message);
    },
    stderr: (message: string) => {
      stderr.push(message);
    },
    stdoutText: () => stdout.join("\n"),
    stderrText: () => stderr.join("\n"),
  };
}

async function initFixtureRepo(
  mode: "numeric" | "judge" | "pareto",
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
    join(repoRoot, "scripts", "propose.mjs"),
    [
      'import { writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'writeFileSync(join(process.cwd(), "docs", "draft.md"), "Improved draft with stronger structure.\\n", "utf8");',
      'console.log("proposal complete");',
    ].join("\n"),
    "utf8",
  );
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
    await writeFile(join(repoRoot, "scripts", "metric.mjs"), 'console.log("0.7");\n', "utf8");
    await writeFile(join(repoRoot, "ralph.yaml"), buildNumericManifest(options), "utf8");
  } else if (mode === "pareto") {
    await writeFile(join(repoRoot, "scripts", "metric-quality.mjs"), 'console.log("0.7");\n', "utf8");
    await writeFile(join(repoRoot, "scripts", "metric-novelty.mjs"), 'console.log("0.7");\n', "utf8");
    await writeFile(join(repoRoot, "ralph.yaml"), buildParetoManifest(options), "utf8");
  } else {
    await writeFile(join(repoRoot, "ralph.yaml"), buildJudgeManifest(options), "utf8");
  }

  await execa("git", ["add", "."], { cwd: repoRoot });
  await execa("git", ["commit", "-m", "fixture"], { cwd: repoRoot });
  await execa("git", ["branch", "-M", "main"], { cwd: repoRoot });

  return repoRoot;
}

function buildNumericManifest(
  options: {
    baselineRef?: string;
    workspace?: "git" | "copy";
    proposerType?: "command" | "operator_llm";
  } = {},
): string {
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
    "  name: cli-numeric",
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

function buildJudgeManifest(options: { baselineRef?: string; workspace?: "git" | "copy" } = {}): string {
  return [
    'schemaVersion: "0.1"',
    "project:",
    "  name: cli-judge",
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
    "        inputs:",
    "          candidate: out/draft.md",
    "          incumbent: frontier.best:draft",
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

function buildParetoManifest(options: { baselineRef?: string; workspace?: "git" | "copy" } = {}): string {
  return [
    'schemaVersion: "0.1"',
    "project:",
    "  name: cli-pareto",
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

function makeAcceptedFrontierRunRecord() {
  return {
    runId: "run-0001",
    cycle: 1,
    candidateId: "candidate-0001",
    status: "accepted" as const,
    phase: "completed" as const,
    pendingAction: "none" as const,
    startedAt: "2026-03-29T00:00:00.000Z",
    endedAt: "2026-03-29T00:10:00.000Z",
    manifestHash: "manifest-hash",
    workspaceRef: "main",
    proposal: {
      proposerType: "command",
      summary: "accepted frontier seed",
      operators: [],
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
        value: 0.9,
        direction: "maximize" as const,
        details: {},
      },
    },
    constraints: [],
    decisionId: "decision-run-0001",
    logs: {},
  };
}

function makeAcceptedFrontierDecisionRecord() {
  return {
    decisionId: "decision-run-0001",
    runId: "run-0001",
    outcome: "accepted" as const,
    actorType: "system" as const,
    policyType: "epsilon_improve",
    metricId: "quality",
    reason: "accepted by seed",
    createdAt: "2026-03-29T00:10:00.000Z",
    frontierChanged: true,
    beforeFrontierIds: [],
    afterFrontierIds: ["frontier-run-0001"],
    commitSha: "abc123",
    auditRequired: false,
  };
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

function makeMetricResult(metricId: string, value: number, confidence?: number) {
  return {
    metricId,
    value,
    direction: "maximize" as const,
    details: {},
    ...(confidence === undefined ? {} : { confidence }),
  };
}

async function seedAcceptedHistory(
  repoRoot: string,
  input: {
    runId: string;
    candidateId: string;
    decisionId: string;
    metricId?: string;
    metrics: Record<string, ReturnType<typeof makeMetricResult>>;
  },
): Promise<void> {
  const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
  const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".ralph", "decisions"));
  const artifactPath = join(repoRoot, ".ralph", "runs", input.runId, "artifacts", "draft.md");

  await mkdir(join(repoRoot, ".ralph", "runs", input.runId, "artifacts"), { recursive: true });
  await writeFile(artifactPath, `${input.runId} artifact\n`, "utf8");

  await runStore.put({
    runId: input.runId,
    cycle: 1,
    candidateId: input.candidateId,
    status: "accepted",
    phase: "completed",
    pendingAction: "none",
    startedAt: "2026-03-29T00:00:00.000Z",
    endedAt: "2026-03-29T00:10:00.000Z",
    manifestHash: "manifest-hash",
    workspaceRef: "main",
    proposal: {
      proposerType: "command",
      summary: "accepted frontier seed",
      operators: [],
    },
    artifacts: [
      {
        id: "draft",
        path: artifactPath,
      },
    ],
    metrics: input.metrics,
    constraints: [],
    decisionId: input.decisionId,
    logs: {},
  });
  await decisionStore.put({
    decisionId: input.decisionId,
    runId: input.runId,
    outcome: "accepted",
    actorType: "system",
    policyType: input.metricId ? "approval_gate" : "pareto_dominance",
    ...(input.metricId ? { metricId: input.metricId } : {}),
    reason: "accepted by seed",
    createdAt: "2026-03-29T00:10:00.000Z",
    frontierChanged: true,
    beforeFrontierIds: [],
    afterFrontierIds: [`frontier-${input.runId}`],
    commitSha: `commit-${input.runId}`,
    auditRequired: false,
  });
}

async function seedPendingHumanRun(
  repoRoot: string,
  input: {
    runId: string;
    candidateId: string;
    decisionId: string;
    metricId: string;
    policyType: string;
    metrics: Record<string, ReturnType<typeof makeMetricResult>>;
  },
): Promise<{
    workspacePath: string;
  }> {
  const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
  const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".ralph", "decisions"));
  const workspaceManager = new GitWorktreeWorkspaceManager(repoRoot, join(repoRoot, ".ralph"));
  const workspace = await workspaceManager.createWorkspace(input.candidateId, "main");
  const artifactPath = join(repoRoot, ".ralph", "runs", input.runId, "artifacts", "draft.md");

  await writeFile(join(workspace.workspacePath, "docs", "draft.md"), `${input.runId} improved draft\n`, "utf8");
  await mkdir(join(repoRoot, ".ralph", "runs", input.runId, "artifacts"), { recursive: true });
  await writeFile(artifactPath, `${input.runId} artifact\n`, "utf8");

  await runStore.put({
    runId: input.runId,
    cycle: 1,
    candidateId: input.candidateId,
    status: "needs_human",
    phase: "decision_written",
    pendingAction: "none",
    startedAt: "2026-03-30T00:00:00.000Z",
    manifestHash: "manifest-hash",
    workspaceRef: "main",
    workspacePath: workspace.workspacePath,
    proposal: {
      proposerType: "command",
      summary: "pending human review",
      operators: [],
      changedPaths: ["docs/draft.md"],
      filesChanged: 1,
      diffLines: 1,
      withinBudget: true,
    },
    artifacts: [
      {
        id: "draft",
        path: artifactPath,
      },
    ],
    metrics: input.metrics,
    constraints: [],
    decisionId: input.decisionId,
    logs: {},
  });
  await decisionStore.put({
    decisionId: input.decisionId,
    runId: input.runId,
    outcome: "needs_human",
    actorType: "system",
    policyType: input.policyType,
    metricId: input.metricId,
    reason: "needs human review",
    createdAt: "2026-03-30T00:05:00.000Z",
    frontierChanged: false,
    beforeFrontierIds: [],
    afterFrontierIds: [],
    auditRequired: false,
  });

  return {
    workspacePath: workspace.workspacePath,
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

async function persistResearchSession(
  repoRoot: string,
  overrides: Partial<ResearchSessionRecord> = {},
): Promise<void> {
  const sessionId = overrides.sessionId ?? "session-001";
  const sessionPath = join(repoRoot, ".ralph", "sessions", sessionId, "session.json");
  const record = researchSessionRecordSchema.parse({
    sessionId,
    goal: "Reach 70% future holdout top-3 prediction success.",
    workingDirectory: repoRoot,
    status: "running",
    agent: {
      type: "codex_cli",
      command: "codex",
    },
    workspace: {
      strategy: "git_worktree",
      currentRef: `refs/heads/${sessionId}`,
      currentPath: join(repoRoot, ".ralph", "sessions", sessionId, "worktree"),
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
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:00:00.000Z",
    ...overrides,
  });

  await mkdir(join(repoRoot, ".ralph", "sessions", sessionId), { recursive: true });
  await writeFile(sessionPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}
