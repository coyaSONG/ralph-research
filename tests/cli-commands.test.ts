import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonFileDecisionStore } from "../src/adapters/fs/json-file-decision-store.js";
import { JsonFileFrontierStore } from "../src/adapters/fs/json-file-frontier-store.js";
import { JsonFileRunStore } from "../src/adapters/fs/json-file-run-store.js";
import type { JudgeProvider, JudgeRequest, JudgeResponse } from "../src/adapters/judge/llm-judge-provider.js";
import { RunCycleService } from "../src/app/services/run-cycle-service.js";
import { runAcceptCommand } from "../src/cli/commands/accept.js";
import { runDoctorCommand } from "../src/cli/commands/doctor.js";
import { runFrontierCommand } from "../src/cli/commands/frontier.js";
import { runInspectCommand } from "../src/cli/commands/inspect.js";
import { runRunCommand } from "../src/cli/commands/run.js";
import { runStatusCommand } from "../src/cli/commands/status.js";

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

    expect(decision?.outcome).toBe("accepted");
    expect(decision?.commitSha).toBeTruthy();
    expect(decision?.reason).toContain("human accepted");
    expect(run?.status).toBe("accepted");
    expect(frontier).toHaveLength(1);
    expect(frontier[0]?.runId).toBe("run-0001");
    expect(frontier[0]?.commitSha).toBe(decision?.commitSha);
    expect(headSha.trim()).toBe(decision?.commitSha);
    expect(committedPaths.trim().split("\n")).toEqual(["docs/draft.md"]);
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
  mode: "numeric" | "judge",
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
