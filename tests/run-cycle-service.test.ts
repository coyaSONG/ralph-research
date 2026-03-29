import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonFileDecisionStore } from "../src/adapters/fs/json-file-decision-store.js";
import { JsonFileFrontierStore } from "../src/adapters/fs/json-file-frontier-store.js";
import { JsonFileRunStore } from "../src/adapters/fs/json-file-run-store.js";
import type { JudgeProvider, JudgeRequest, JudgeResponse } from "../src/adapters/judge/llm-judge-provider.js";
import { RunCycleService } from "../src/app/services/run-cycle-service.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "research-ratchet-service-"));
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
    expect(decision?.outcome).toBe("accepted");
    expect(decision?.commitSha).toBeTruthy();
    expect(frontier).toHaveLength(1);
    expect(frontier[0]?.metrics.quality.value).toBeCloseTo(0.7);
    expect(frontier[0]?.commitSha).toBe(decision?.commitSha);
    expect(headSha.trim()).toBe(decision?.commitSha);
    expect(committedPaths.trim().split("\n")).toEqual(["docs/draft.md"]);
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
});

async function initFixtureRepo(mode: "numeric" | "judge" | "graduation" | "history"): Promise<string> {
  const repoRoot = join(tempRoot, `repo-${mode}`);
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await mkdir(join(repoRoot, "scripts"), { recursive: true });
  await mkdir(join(repoRoot, "prompts"), { recursive: true });

  await execa("git", ["init"], { cwd: repoRoot });
  await execa("git", ["config", "user.name", "Research Ratchet Tests"], { cwd: repoRoot });
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
    await writeFile(join(repoRoot, "ralph.yaml"), buildNumericManifest(), "utf8");
  } else if (mode === "judge") {
    await writeFile(join(repoRoot, "scripts", "propose.mjs"), buildDefaultProposerScript(), "utf8");
    await writeFile(join(repoRoot, "ralph.yaml"), buildJudgeManifest(), "utf8");
  } else if (mode === "graduation") {
    await writeFile(join(repoRoot, "scripts", "propose.mjs"), buildGraduationProposerScript(), "utf8");
    await writeFile(join(repoRoot, "ralph.yaml"), buildGraduationManifest(), "utf8");
  } else {
    await writeFile(join(repoRoot, "scripts", "propose.mjs"), buildHistoryAwareProposerScript(), "utf8");
    await writeFile(join(repoRoot, "scripts", "metric.mjs"), buildHistoryMetricScript(), "utf8");
    await writeFile(join(repoRoot, "ralph.yaml"), buildHistoryManifest(), "utf8");
  }

  await execa("git", ["add", "."], { cwd: repoRoot });
  await execa("git", ["commit", "-m", "fixture"], { cwd: repoRoot });

  return repoRoot;
}

function buildDefaultProposerScript(): string {
  return [
    'import { writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'writeFileSync(join(process.cwd(), "docs", "draft.md"), "Improved draft with stronger structure.\\n", "utf8");',
    'console.log("proposal complete");',
  ].join("\n");
}

function buildNumericManifest(): string {
  return [
    'schemaVersion: "0.1"',
    "project:",
    "  name: service-numeric",
    "  artifact: manuscript",
    "  baselineRef: main",
    "  workspace: git",
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

function buildJudgeManifest(): string {
  return [
    'schemaVersion: "0.1"',
    "project:",
    "  name: service-judge",
    "  artifact: manuscript",
    "  baselineRef: main",
    "  workspace: git",
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

function buildGraduationManifest(): string {
  return [
    'schemaVersion: "0.1"',
    "project:",
    "  name: service-graduation",
    "  artifact: manuscript",
    "  baselineRef: main",
    "  workspace: git",
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

function buildHistoryManifest(): string {
  return [
    'schemaVersion: "0.1"',
    "project:",
    "  name: service-history",
    "  artifact: manuscript",
    "  baselineRef: main",
    "  workspace: git",
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

function buildHistoryMetricScript(): string {
  return [
    'import { readFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'const draft = readFileSync(join(process.cwd(), "out", "draft.md"), "utf8");',
    'console.log(draft.includes("run-0001") ? "0.9" : "0.7");',
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
