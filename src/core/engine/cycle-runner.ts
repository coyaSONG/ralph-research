import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

import type { DecisionStore } from "../ports/decision-store.js";
import type { FrontierStore } from "../ports/frontier-store.js";
import type { RunStore } from "../ports/run-store.js";
import type {
  CommandMetricExtractorConfig,
  CommandProposerConfig,
  JudgePack,
  LlmJudgeMetricExtractorConfig,
  RalphManifest,
} from "../manifest/schema.js";
import type { ConstraintEvaluation } from "../state/constraint-engine.js";
import type { DecisionRecord } from "../model/decision-record.js";
import type { FrontierEntry } from "../model/frontier-entry.js";
import type { MetricResult } from "../model/metric.js";
import type { RunRecord } from "../model/run-record.js";
import { evaluateAnchorAgreement, applyAnchorAgreementGate, loadAnchorRecords, type AnchorCheckResult } from "./anchor-checker.js";
import { sampleAuditQueue, type AuditQueueItem } from "./audit-sampler.js";
import { evaluateChangeBudget, type ChangeBudgetDecision } from "./change-budget.js";
import { compactRecentHistory, countConsecutiveAutoAccepts } from "./history-compactor.js";
import { runExperiment } from "./experiment-runner.js";
import { runLlmJudgeMetric } from "./judge-pack.js";
import { GitWorktreeWorkspaceManager } from "./workspace-manager.js";
import { extractCommandMetric } from "../../adapters/extractor/command-extractor.js";
import { GitClient } from "../../adapters/git/git-client.js";
import type { JudgeProvider } from "../../adapters/judge/llm-judge-provider.js";
import { runCommandProposer } from "../../adapters/proposer/command-proposer.js";
import { evaluateConstraints } from "../state/constraint-engine.js";
import { updateSingleBestFrontier } from "../state/frontier-engine.js";
import { evaluateRatchet, type RatchetDecision } from "../state/ratchet-engine.js";
import { advanceRunPhase } from "../state/run-state-machine.js";

export interface CycleRunnerDependencies {
  runStore: RunStore;
  decisionStore: DecisionStore;
  frontierStore: FrontierStore;
  workspaceManager: GitWorktreeWorkspaceManager;
  gitClient: GitClient;
  judgeProvider?: JudgeProvider;
  now?: () => Date;
}

export interface RunCycleInput {
  repoRoot: string;
  manifestPath: string;
  manifest: RalphManifest;
  currentFrontier: FrontierEntry[];
}

export type CycleRunStatus =
  | "accepted"
  | "rejected"
  | "needs_human"
  | "failed";

export interface CycleRunResult {
  status: CycleRunStatus;
  run: RunRecord;
  decision?: DecisionRecord;
  frontier: FrontierEntry[];
  auditQueue: AuditQueueItem[];
  changeBudget?: ChangeBudgetDecision;
  anchorCheck?: AnchorCheckResult;
}

interface RunContext {
  runId: string;
  cycle: number;
  candidateId: string;
  runDir: string;
  startedAt: string;
  manifestHash: string;
}

export async function runCycle(
  input: RunCycleInput,
  dependencies: CycleRunnerDependencies,
): Promise<CycleRunResult> {
  const now = dependencies.now ?? (() => new Date());
  const context = await createRunContext(input.repoRoot, input.manifest, dependencies.runStore, now);
  const manifestDir = dirname(input.manifestPath);
  const workspace = await dependencies.workspaceManager.createWorkspace(context.candidateId);
  const primaryMetric = getPrimaryMetric(input.manifest);
  const priorRuns = await dependencies.runStore.list();
  const priorDecisions = await dependencies.decisionStore.list();
  const priorConsecutiveAccepts = countConsecutiveAutoAccepts(priorDecisions, {
    metricId: input.manifest.ratchet.metric ?? primaryMetric,
  });

  let runRecord = createInitialRunRecord(input.manifest, workspace.workspacePath, context);
  await dependencies.runStore.put(runRecord);

  let frontier = input.currentFrontier;

  try {
    const proposerHistory = await buildProposerHistoryContext({
      manifest: input.manifest,
      runDir: context.runDir,
      runs: priorRuns,
      decisions: priorDecisions,
      primaryMetric,
    });
    const proposal = await executeProposal(input.manifest, workspace.workspacePath, proposerHistory);
    const proposeStdoutPath = await persistText(join(context.runDir, "logs", "propose.stdout.log"), proposal.stdout);

    runRecord = {
      ...runRecord,
      proposal: {
        ...runRecord.proposal,
        proposerType: proposal.proposerType,
        summary: proposerHistory ? `${proposal.summary}; history_context=enabled` : proposal.summary,
      },
      logs: {
        ...runRecord.logs,
        proposeStdoutPath,
      },
    };
    await dependencies.runStore.put(runRecord);

    const experiment = await runExperiment(input.manifest.experiment.run, {
      workspacePath: workspace.workspacePath,
    });
    const runStdoutPath = await persistText(join(context.runDir, "logs", "experiment.stdout.log"), experiment.stdout);
    runRecord = advanceRunPhase(
      {
        ...runRecord,
        logs: {
          ...runRecord.logs,
          runStdoutPath,
        },
      },
      "executed",
    );
    await dependencies.runStore.put(runRecord);

    const metricEvaluation = await evaluateMetrics({
      repoRoot: input.repoRoot,
      manifestDir,
      manifest: input.manifest,
      currentFrontier: frontier,
      workspacePath: workspace.workspacePath,
      runDir: context.runDir,
      ...(dependencies.judgeProvider ? { judgeProvider: dependencies.judgeProvider } : {}),
    });

    const artifacts = await snapshotArtifacts(
      input.manifest.experiment.outputs,
      workspace.workspacePath,
      join(context.runDir, "artifacts"),
    );

    const constraintSummary = evaluateConstraints(input.manifest.constraints, metricEvaluation.metrics);
    const changeBudget = await evaluateChangeBudget({
      workspacePath: workspace.workspacePath,
      scope: input.manifest.scope,
    });

    let ratchetDecision = resolveDecision({
      manifest: input.manifest,
      metrics: metricEvaluation.metrics,
      currentFrontier: frontier,
      constraints: constraintSummary,
      changeBudget,
      priorConsecutiveAccepts,
    });

    let anchorCheck: AnchorCheckResult | undefined;
    if (ratchetDecision.outcome === "accepted") {
      anchorCheck = metricEvaluation.anchorChecks.get(ratchetDecision.metricId);
      if (anchorCheck) {
        const gated = applyAnchorAgreementGate(ratchetDecision.outcome, anchorCheck);
        ratchetDecision = {
          ...ratchetDecision,
          outcome: gated.outcome,
          frontierChanged: gated.outcome === "accepted",
          reason: `${ratchetDecision.reason}; ${gated.reason}`,
        };
      }
    }

    runRecord = advanceRunPhase(
      {
        ...runRecord,
        proposal: {
          ...runRecord.proposal,
          diffLines: changeBudget.summary.totalLineDelta,
          filesChanged: changeBudget.summary.filesChanged,
          changedPaths: changeBudget.summary.entries.map((entry) => entry.path),
          withinBudget: changeBudget.withinBudget,
        },
        metrics: metricEvaluation.metrics,
        constraints: constraintSummary.results.map(stripConstraintReason),
        artifacts,
      },
      "evaluated",
      {
        status: ratchetDecision.outcome,
      },
    );
    await dependencies.runStore.put(runRecord);

    const decisionId = `decision-${context.runId}`;
    const candidateFrontierEntry = buildFrontierEntry(context.runId, context.candidateId, now, metricEvaluation.metrics, artifacts);
    const frontierUpdate =
      ratchetDecision.outcome === "accepted"
        ? updateSingleBestFrontier(frontier, candidateFrontierEntry, primaryMetric)
        : null;

    let decisionRecord: DecisionRecord = {
      decisionId,
      runId: context.runId,
      outcome: ratchetDecision.outcome,
      actorType: "system",
      policyType: ratchetDecision.policyType,
      metricId: ratchetDecision.metricId,
      ...(ratchetDecision.delta === undefined ? {} : { delta: ratchetDecision.delta }),
      reason: ratchetDecision.reason,
      createdAt: now().toISOString(),
      frontierChanged: frontierUpdate?.comparison.frontierChanged ?? false,
      beforeFrontierIds: frontier.map((entry) => entry.frontierId),
      afterFrontierIds: (frontierUpdate?.entries ?? frontier).map((entry) => entry.frontierId),
      auditRequired: false,
      ...(ratchetDecision.graduation ? { graduation: ratchetDecision.graduation } : {}),
    };
    let auditQueue = buildAuditQueue(ratchetDecision.metricId, decisionRecord, input.manifest, metricEvaluation.packByMetricId);
    decisionRecord = {
      ...decisionRecord,
      auditRequired: auditQueue.length > 0,
    };
    await dependencies.decisionStore.put(decisionRecord);

    runRecord = advanceRunPhase(runRecord, "decision_written", {
      status: ratchetDecision.outcome,
      decisionId,
    });
    await dependencies.runStore.put(runRecord);

    if (ratchetDecision.outcome === "accepted" && frontierUpdate) {
      const promoted = await dependencies.workspaceManager.promoteWorkspace(context.candidateId, {
        excludePaths: input.manifest.experiment.outputs.map((output) => output.path),
      });
      const commitResult = await dependencies.gitClient.stageAndCommitPaths(
        [...promoted.copiedPaths, ...promoted.deletedPaths],
        `rrx: accept ${context.runId}`,
      );
      decisionRecord = {
        ...decisionRecord,
        commitSha: commitResult.commitSha,
      };
      await dependencies.decisionStore.put(decisionRecord);

      frontier = frontierUpdate.entries.map((entry) => ({
        ...entry,
        commitSha: commitResult.commitSha,
      }));

      runRecord = advanceRunPhase(runRecord, "committed");
      await dependencies.runStore.put(runRecord);

      await dependencies.frontierStore.save(frontier);
      runRecord = advanceRunPhase(runRecord, "frontier_updated");
      await dependencies.runStore.put(runRecord);
    }

    if (ratchetDecision.outcome !== "needs_human") {
      await dependencies.workspaceManager.cleanupWorkspace(context.candidateId);
    }
    runRecord = advanceRunPhase(runRecord, "completed", {
      status: ratchetDecision.outcome,
    });
    await dependencies.runStore.put(runRecord);

    return {
      status: ratchetDecision.outcome,
      run: runRecord,
      decision: decisionRecord,
      frontier,
      auditQueue,
      changeBudget,
      ...(anchorCheck ? { anchorCheck } : {}),
    };
  } catch (error) {
    runRecord = advanceRunPhase(runRecord, "failed", {
      error: {
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      },
      status: "failed",
    });
    await dependencies.runStore.put(runRecord);

    return {
      status: "failed",
      run: runRecord,
      frontier,
      auditQueue: [],
    };
  }
}

async function createRunContext(
  repoRoot: string,
  manifest: RalphManifest,
  runStore: RunStore,
  now: () => Date,
): Promise<RunContext> {
  const runs = await runStore.list();
  const nextCycle = runs.reduce((highest, run) => Math.max(highest, run.cycle), 0) + 1;
  const runId = `run-${String(nextCycle).padStart(4, "0")}`;
  const candidateId = `candidate-${String(nextCycle).padStart(4, "0")}`;
  const runDir = join(resolve(repoRoot), manifest.storage.root, "runs", runId);
  const startedAt = now().toISOString();
  const manifestHash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");

  return {
    runId,
    cycle: nextCycle,
    candidateId,
    runDir,
    startedAt,
    manifestHash,
  };
}

function createInitialRunRecord(manifest: RalphManifest, workspacePath: string, context: RunContext): RunRecord {
  return {
    runId: context.runId,
    cycle: context.cycle,
    candidateId: context.candidateId,
    status: "running",
    phase: "proposed",
    pendingAction: "execute_experiment",
    startedAt: context.startedAt,
    manifestHash: context.manifestHash,
    workspaceRef: manifest.project.baselineRef,
    workspacePath,
    proposal: {
      proposerType: manifest.proposer.type,
      summary: "proposal pending",
      operators: manifest.proposer.type === "operator_llm" ? manifest.proposer.operators : [],
    },
    artifacts: [],
    metrics: {},
    constraints: [],
    logs: {},
  };
}

async function executeProposal(
  manifest: RalphManifest,
  workspacePath: string,
  historyContext?: { summary: string; path: string },
) {
  if (manifest.proposer.type !== "command") {
    throw new Error(`unsupported proposer type ${manifest.proposer.type} in v0.1 cycle runner`);
  }

  return runCommandProposer(manifest.proposer as CommandProposerConfig, {
    workspacePath,
    ...(historyContext
      ? {
          env: {
            RRX_HISTORY_ENABLED: "1",
            RRX_HISTORY_SUMMARY: historyContext.summary,
            RRX_HISTORY_PATH: historyContext.path,
          },
        }
      : {}),
  });
}

async function buildProposerHistoryContext(input: {
  manifest: RalphManifest;
  runDir: string;
  runs: RunRecord[];
  decisions: DecisionRecord[];
  primaryMetric: string;
}): Promise<{ summary: string; path: string } | undefined> {
  if (!input.manifest.proposer.history.enabled) {
    return undefined;
  }

  const snapshot = compactRecentHistory({
    runs: input.runs.filter((run) => run.phase === "completed"),
    decisions: input.decisions,
    maxRuns: input.manifest.proposer.history.maxRuns,
    primaryMetric: input.primaryMetric,
  });
  const path = join(input.runDir, "history", "proposer-history.md");
  await persistText(path, snapshot.summary);

  return {
    summary: snapshot.summary,
    path,
  };
}

interface EvaluateMetricsInput {
  repoRoot: string;
  manifestDir: string;
  manifest: RalphManifest;
  currentFrontier: FrontierEntry[];
  workspacePath: string;
  runDir: string;
  judgeProvider?: JudgeProvider;
}

async function evaluateMetrics(
  input: EvaluateMetricsInput,
): Promise<{
  metrics: Record<string, MetricResult>;
  anchorChecks: Map<string, AnchorCheckResult>;
  packByMetricId: Map<string, JudgePack>;
}> {
  const metrics: Record<string, MetricResult> = {};
  const anchorChecks = new Map<string, AnchorCheckResult>();
  const anchorCheckCache = new Map<string, AnchorCheckResult>();
  const packByMetricId = new Map<string, JudgePack>();

  for (const metricDefinition of input.manifest.metrics.catalog) {
    if (metricDefinition.extractor.type === "command") {
      metrics[metricDefinition.id] = await extractCommandMetric(
        metricDefinition.extractor as CommandMetricExtractorConfig,
        {
          metricId: metricDefinition.id,
          direction: metricDefinition.direction,
          workspacePath: input.workspacePath,
        },
      );
      continue;
    }

    if (!input.judgeProvider) {
      throw new Error(`metric ${metricDefinition.id} requires a judge provider`);
    }

    const extractor = metricDefinition.extractor as LlmJudgeMetricExtractorConfig;
    const pack = getJudgePack(input.manifest, extractor.judgePack);
    packByMetricId.set(metricDefinition.id, pack);

    const prompt = await buildJudgePrompt({
      repoRoot: input.repoRoot,
      manifestDir: input.manifestDir,
      workspacePath: input.workspacePath,
      extractor,
      frontier: input.currentFrontier,
    });

    const metric = await runLlmJudgeMetric({
      metricId: metricDefinition.id,
      direction: metricDefinition.direction,
      extractor,
      pack,
      prompt,
      provider: input.judgeProvider,
    });

    const judgeTracePath = join(input.runDir, "judge", `${metricDefinition.id}.json`);
    await persistJson(judgeTracePath, metric.details);
    metrics[metricDefinition.id] = {
      ...metric,
      judgeTracePath,
      details: {
        ...metric.details,
        judgeTracePath,
      },
    };

    if (!anchorCheckCache.has(pack.id)) {
      const anchors = pack.anchors ? await loadAnchorRecords(resolve(input.manifestDir, pack.anchors.path)) : [];
      anchorCheckCache.set(
        pack.id,
        await evaluateAnchorAgreement({
          pack,
          extractor,
          provider: input.judgeProvider,
          anchors,
        }),
      );
    }

    anchorChecks.set(metricDefinition.id, anchorCheckCache.get(pack.id)!);
  }

  return {
    metrics,
    anchorChecks,
    packByMetricId,
  };
}

function resolveDecision(input: {
  manifest: RalphManifest;
  metrics: Record<string, MetricResult>;
  currentFrontier: FrontierEntry[];
  constraints: { passed: boolean; reason: string };
  changeBudget: ChangeBudgetDecision;
  priorConsecutiveAccepts: number;
}): RatchetDecision {
  if (!input.changeBudget.withinBudget) {
    return {
      outcome: input.changeBudget.outcome === "needs_human" ? "needs_human" : "rejected",
      frontierChanged: false,
      metricId: getPrimaryMetric(input.manifest),
      policyType: input.manifest.ratchet.type,
      reason: input.changeBudget.reason,
    };
  }

  return evaluateRatchet({
    ratchet: input.manifest.ratchet,
    primaryMetric: getPrimaryMetric(input.manifest),
    candidateMetrics: input.metrics,
    currentFrontier: input.currentFrontier,
    priorConsecutiveAccepts: input.priorConsecutiveAccepts,
    ...(input.constraints.passed ? {} : { constraintFailureReason: input.constraints.reason }),
  });
}

function buildFrontierEntry(
  runId: string,
  candidateId: string,
  now: () => Date,
  metrics: Record<string, MetricResult>,
  artifacts: FrontierEntry["artifacts"],
): FrontierEntry {
  return {
    frontierId: `frontier-${runId}`,
    runId,
    candidateId,
    acceptedAt: now().toISOString(),
    metrics,
    artifacts,
  };
}

function buildAuditQueue(
  metricId: string,
  decision: DecisionRecord,
  manifest: RalphManifest,
  packByMetricId: Map<string, JudgePack>,
): AuditQueueItem[] {
  const pack = packByMetricId.get(metricId);
  if (!pack) {
    return [];
  }

  return sampleAuditQueue(
    [
      {
        runId: decision.runId,
        decisionId: decision.decisionId,
        outcome: decision.outcome,
        metricId,
        reason: decision.reason,
      },
    ],
    pack,
    decision.createdAt,
  );
}

async function buildJudgePrompt(input: {
  repoRoot: string;
  manifestDir: string;
  workspacePath: string;
  extractor: LlmJudgeMetricExtractorConfig;
  frontier: FrontierEntry[];
}): Promise<string> {
  const template = await readTemplateOrInline(input.manifestDir, input.extractor.prompt);
  const sections: string[] = [template];

  for (const [key, source] of Object.entries(input.extractor.inputs)) {
    const value = await resolvePromptInput(source, input.workspacePath, input.frontier);
    sections.push(`\n[${key}]\n${value}`);
  }

  return sections.join("\n");
}

async function resolvePromptInput(source: string, workspacePath: string, frontier: FrontierEntry[]): Promise<string> {
  if (source.startsWith("frontier.best:")) {
    const reference = source.slice("frontier.best:".length);
    const incumbent = frontier[0];
    if (!incumbent) {
      return "";
    }

    const artifact = incumbent.artifacts.find((entry) => entry.id === reference || entry.path.endsWith(reference));
    if (!artifact) {
      return "";
    }

    return readFile(resolve(artifact.path), "utf8");
  }

  const candidatePath = resolve(workspacePath, source);
  try {
    return await readFile(candidatePath, "utf8");
  } catch {
    return source;
  }
}

async function readTemplateOrInline(baseDir: string, value: string): Promise<string> {
  const candidatePath = resolve(baseDir, value);
  try {
    return await readFile(candidatePath, "utf8");
  } catch {
    return value;
  }
}

async function snapshotArtifacts(
  outputs: RalphManifest["experiment"]["outputs"],
  workspacePath: string,
  artifactRoot: string,
): Promise<FrontierEntry["artifacts"]> {
  const artifacts: FrontierEntry["artifacts"] = [];
  for (const output of outputs) {
    const sourcePath = resolve(workspacePath, output.path);
    const destinationPath = join(artifactRoot, `${output.id}${extname(output.path) || ".txt"}`);
    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
    artifacts.push({
      id: output.id,
      path: destinationPath,
    });
  }

  return artifacts;
}

function stripConstraintReason(constraint: ConstraintEvaluation): Omit<ConstraintEvaluation, "reason"> {
  return {
    metric: constraint.metric,
    passed: constraint.passed,
    actual: constraint.actual,
    expected: constraint.expected,
    op: constraint.op,
  };
}

async function persistText(path: string, value: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
  return path;
}

async function persistJson(path: string, value: unknown): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

function getJudgePack(manifest: RalphManifest, judgePackId: string): JudgePack {
  const pack = manifest.judgePacks.find((entry) => entry.id === judgePackId);
  if (!pack) {
    throw new Error(`unknown judge pack ${judgePackId}`);
  }
  return pack;
}

function getPrimaryMetric(manifest: RalphManifest): string {
  if (manifest.frontier.strategy !== "single_best") {
    throw new Error(`frontier strategy ${manifest.frontier.strategy} is not supported in v0.1 cycle runner`);
  }

  return manifest.frontier.primaryMetric;
}
