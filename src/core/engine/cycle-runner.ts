import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

import type { DecisionStore } from "../ports/decision-store.js";
import type { FrontierStore } from "../ports/frontier-store.js";
import type { RunStore } from "../ports/run-store.js";
import type {
  CommandMetricExtractorConfig,
  JudgePack,
  LeafProposerConfig,
  LlmJudgeMetricExtractorConfig,
  RalphManifest,
} from "../manifest/schema.js";
import type { ConstraintEvaluation } from "../state/constraint-engine.js";
import type { CodexCliCycleSessionContext } from "../model/codex-cli-cycle-session.js";
import type { DecisionRecord } from "../model/decision-record.js";
import type { FrontierEntry } from "../model/frontier-entry.js";
import { summarizeMetricDiagnostics } from "../model/metric-diagnostics.js";
import type { MetricResult } from "../model/metric.js";
import type { ProposalAdapterMetadata, RunRecord } from "../model/run-record.js";
import { evaluateAnchorAgreement, applyAnchorAgreementGate, loadAnchorRecords, type AnchorCheckResult } from "./anchor-checker.js";
import { sampleAuditQueue, type AuditQueueItem } from "./audit-sampler.js";
import { evaluateChangeBudget, type ChangeBudgetDecision } from "./change-budget.js";
import { compactRecentHistory, countConsecutiveAutoAccepts } from "./history-compactor.js";
import { preparePromotionArtifact, requirePromotionPatch, requirePromotionPaths } from "./promotion-artifact.js";
import { runExperiment } from "./experiment-runner.js";
import { runLlmJudgeMetric } from "./judge-pack.js";
import { runParallelProposers } from "./parallel-proposer.js";
import { GitWorktreeWorkspaceManager } from "./workspace-manager.js";
import { extractCommandMetric } from "../../adapters/extractor/command-extractor.js";
import { GitClient } from "../../adapters/git/git-client.js";
import type { JudgeProvider } from "../../adapters/judge/llm-judge-provider.js";
import { createProposerRunner } from "../../adapters/proposer/proposer-factory.js";
import { evaluateConstraints } from "../state/constraint-engine.js";
import {
  attachCommitShaToFrontierEntries,
  buildAcceptedFrontierEntry,
  updateAcceptedFrontier,
} from "../state/frontier-semantics.js";
import { evaluateRatchet, type RatchetDecision } from "../state/ratchet-engine.js";
import { advanceRunPhase } from "../state/run-state-machine.js";
import { derivePendingAction } from "../state/recovery-classifier.js";

export interface CycleRunnerDependencies {
  runStore: RunStore;
  decisionStore: DecisionStore;
  frontierStore: FrontierStore;
  workspaceManager: GitWorktreeWorkspaceManager;
  gitClient: GitClient;
  judgeProvider?: JudgeProvider;
  now?: () => Date;
  createProposerRunner?: typeof createProposerRunner;
}

export interface RunCycleInput {
  repoRoot: string;
  manifestPath: string;
  manifest: RalphManifest;
  resolvedBaselineRef: string;
  currentFrontier: FrontierEntry[];
  codexSession?: CodexCliCycleSessionContext;
  resumeRun?: RunRecord;
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

interface CandidateAttemptResult {
  candidateId: string;
  workspacePath: string;
  proposerType: string;
  operators: string[];
  summary: string;
  adapterMetadata?: ProposalAdapterMetadata;
  proposeStdoutPath: string;
  runStdoutPath: string;
  metrics: Record<string, MetricResult>;
  artifacts: FrontierEntry["artifacts"];
  constraints: ReturnType<typeof evaluateConstraints>;
  changeBudget: ChangeBudgetDecision;
  anchorChecks: Map<string, AnchorCheckResult>;
  packByMetricId: Map<string, JudgePack>;
}

export async function runCycle(
  input: RunCycleInput,
  dependencies: CycleRunnerDependencies,
): Promise<CycleRunResult> {
  if (input.manifest.proposer.type !== "parallel") {
    return runCommandCycle(input, dependencies);
  }

  if (input.resumeRun) {
    throw new Error("parallel proposer runs cannot be resumed truthfully yet");
  }

  const now = dependencies.now ?? (() => new Date());
  const context = await createRunContext(input.repoRoot, input.manifest, dependencies.runStore, now);
  const manifestDir = dirname(input.manifestPath);
  const referenceMetric = getReferenceMetric(input.manifest);
  const priorRuns = await dependencies.runStore.list();
  const priorDecisions = await dependencies.decisionStore.list();
  const priorConsecutiveAccepts = countConsecutiveAutoAccepts(priorDecisions, {
    metricId: "metric" in input.manifest.ratchet ? input.manifest.ratchet.metric ?? referenceMetric : referenceMetric,
  });

  let runRecord = createInitialRunRecord(input.manifest, input.resolvedBaselineRef, undefined, context);
  await dependencies.runStore.put(runRecord);

  let frontier = input.currentFrontier;

  try {
    const proposerHistory = await buildProposerHistoryContext({
      manifest: input.manifest,
      runDir: context.runDir,
      runs: priorRuns,
      decisions: priorDecisions,
      primaryMetric: referenceMetric,
    });
    const selectedCandidate = await prepareCandidateAttempt({
      repoRoot: input.repoRoot,
      manifestDir,
      manifest: input.manifest,
      resolvedBaselineRef: input.resolvedBaselineRef,
      runDir: context.runDir,
      workspaceManager: dependencies.workspaceManager,
      currentFrontier: frontier,
      baseCandidateId: context.candidateId,
      referenceMetric,
      ...(dependencies.createProposerRunner ? { createProposerRunner: dependencies.createProposerRunner } : {}),
      ...(proposerHistory ? { historyContext: proposerHistory } : {}),
      ...(dependencies.judgeProvider ? { judgeProvider: dependencies.judgeProvider } : {}),
    });

    runRecord = {
      ...runRecord,
      candidateId: selectedCandidate.candidateId,
      workspacePath: selectedCandidate.workspacePath,
      proposal: {
        ...runRecord.proposal,
        proposerType: input.manifest.proposer.type,
        summary: selectedCandidate.summary,
        operators: selectedCandidate.operators,
        ...(selectedCandidate.adapterMetadata ? { adapterMetadata: selectedCandidate.adapterMetadata } : {}),
      },
      logs: {
        ...runRecord.logs,
        proposeStdoutPath: selectedCandidate.proposeStdoutPath,
        runStdoutPath: selectedCandidate.runStdoutPath,
      },
    };
    runRecord = advanceRunPhase(
      runRecord,
      "executed",
    );
    await dependencies.runStore.put(runRecord);

    let ratchetDecision = resolveDecision({
      manifest: input.manifest,
      metrics: selectedCandidate.metrics,
      currentFrontier: frontier,
      constraints: selectedCandidate.constraints,
      changeBudget: selectedCandidate.changeBudget,
      priorConsecutiveAccepts,
    });

    let anchorCheck: AnchorCheckResult | undefined;
    if (ratchetDecision.outcome === "accepted") {
      anchorCheck = selectedCandidate.anchorChecks.get(ratchetDecision.metricId);
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
          diffLines: selectedCandidate.changeBudget.summary.totalLineDelta,
          filesChanged: selectedCandidate.changeBudget.summary.filesChanged,
          changedPaths: selectedCandidate.changeBudget.summary.entries.map((entry) => entry.path),
          withinBudget: selectedCandidate.changeBudget.withinBudget,
        },
        metrics: selectedCandidate.metrics,
        constraints: selectedCandidate.constraints.results.map(stripConstraintReason),
        artifacts: selectedCandidate.artifacts,
      },
      "evaluated",
      {
        status: ratchetDecision.outcome,
      },
    );
    await dependencies.runStore.put(runRecord);

    const decisionId = `decision-${context.runId}`;
    const decisionCreatedAt = now().toISOString();
    const candidateFrontierEntry = buildAcceptedFrontierEntry({
      runId: context.runId,
      candidateId: selectedCandidate.candidateId,
      acceptedAt: decisionCreatedAt,
      metrics: selectedCandidate.metrics,
      artifacts: selectedCandidate.artifacts,
    });
    const frontierUpdate =
      ratchetDecision.outcome === "accepted"
        ? updateAcceptedFrontier(input.manifest, frontier, candidateFrontierEntry)
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
      createdAt: decisionCreatedAt,
      frontierChanged: frontierUpdate?.comparison.frontierChanged ?? false,
      beforeFrontierIds: frontier.map((entry) => entry.frontierId),
      afterFrontierIds: (frontierUpdate?.entries ?? frontier).map((entry) => entry.frontierId),
      auditRequired: false,
      ...(buildDecisionDiagnostics(selectedCandidate.metrics[ratchetDecision.metricId])
        ? { diagnostics: buildDecisionDiagnostics(selectedCandidate.metrics[ratchetDecision.metricId]) }
        : {}),
      ...(ratchetDecision.graduation ? { graduation: ratchetDecision.graduation } : {}),
    };
    if (ratchetDecision.outcome === "accepted") {
      const promotion = await preparePromotionArtifact({
        candidateId: selectedCandidate.candidateId,
        runDir: context.runDir,
        manifest: input.manifest,
        workspaceManager: dependencies.workspaceManager,
      });
      runRecord = {
        ...runRecord,
        proposal: {
          ...runRecord.proposal,
          patchPath: promotion.patchPath,
          changedPaths: promotion.changedPaths,
          filesChanged: promotion.changedPaths.length,
        },
      };
    }
    let auditQueue = buildAuditQueue(ratchetDecision.metricId, decisionRecord, input.manifest, selectedCandidate.packByMetricId);
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
      await dependencies.gitClient.applyPatchIfNeeded(requirePromotionPatch(runRecord));
      const commitResult = await dependencies.gitClient.stageAndCommitPaths(
        requirePromotionPaths(runRecord),
        `rrx: accept ${context.runId}`,
      );
      decisionRecord = {
        ...decisionRecord,
        commitSha: commitResult.commitSha,
      };
      await dependencies.decisionStore.put(decisionRecord);

      frontier = attachCommitShaToFrontierEntries(
        frontierUpdate.entries,
        context.runId,
        commitResult.commitSha,
      );

      runRecord = advanceRunPhase(runRecord, "committed");
      await dependencies.runStore.put(runRecord);

      await dependencies.frontierStore.save(frontier);
      runRecord = advanceRunPhase(runRecord, "frontier_updated");
      await dependencies.runStore.put(runRecord);
    }

    if (ratchetDecision.outcome !== "needs_human") {
      await dependencies.workspaceManager.cleanupWorkspace(selectedCandidate.candidateId);
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
      changeBudget: selectedCandidate.changeBudget,
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

async function runCommandCycle(
  input: RunCycleInput,
  dependencies: CycleRunnerDependencies,
): Promise<CycleRunResult> {
  if (input.manifest.proposer.type === "parallel") {
    throw new Error("parallel proposers must be routed through the parallel cycle runner");
  }

  const proposer = input.manifest.proposer;
  const now = dependencies.now ?? (() => new Date());
  const manifestDir = dirname(input.manifestPath);
  const referenceMetric = getReferenceMetric(input.manifest);
  const priorRuns = await dependencies.runStore.list();
  const priorDecisions = await dependencies.decisionStore.list();
  const priorConsecutiveAccepts = countConsecutiveAutoAccepts(priorDecisions, {
    metricId: "metric" in input.manifest.ratchet ? input.manifest.ratchet.metric ?? referenceMetric : referenceMetric,
  });
  const context = input.resumeRun
    ? createRunContextFromRecord(input.repoRoot, input.manifest, input.resumeRun)
    : await createRunContext(input.repoRoot, input.manifest, dependencies.runStore, now);

  let runRecord = input.resumeRun
    ? input.resumeRun
    : createInitialRunRecord(input.manifest, input.resolvedBaselineRef, undefined, context);
  if (!input.resumeRun) {
    await dependencies.runStore.put(runRecord);
  }

  let frontier = input.currentFrontier;
  let decisionRecord = runRecord.decisionId
    ? await dependencies.decisionStore.get(runRecord.decisionId)
    : null;
  let auditQueue: AuditQueueItem[] = [];
  let lastChangeBudget: ChangeBudgetDecision | undefined;
  let lastAnchorCheck: AnchorCheckResult | undefined;

  try {
    while (true) {
      const nextAction = runRecord.pendingAction !== "none"
        ? runRecord.pendingAction
        : derivePendingAction(runRecord);

      switch (nextAction) {
        case "prepare_proposal": {
          const proposerHistory = await buildProposerHistoryContext({
            manifest: input.manifest,
            runDir: context.runDir,
            runs: priorRuns,
            decisions: priorDecisions,
            primaryMetric: referenceMetric,
          });
          const workspacePath = runRecord.workspacePath
            ?? (await dependencies.workspaceManager.createWorkspace(runRecord.candidateId, input.resolvedBaselineRef)).workspacePath;
          const proposal = await executeProposal(
            proposer,
            workspacePath,
            dependencies.createProposerRunner,
            proposerHistory,
            input.codexSession,
          );
          const proposeStdoutPath = await persistText(
            join(context.runDir, "logs", `${runRecord.candidateId}.propose.stdout.log`),
            proposal.stdout,
          );

          runRecord = advanceRunPhase(
            {
              ...runRecord,
              workspacePath,
              proposal: {
                ...runRecord.proposal,
                proposerType: proposer.type,
                summary: proposerHistory ? `${proposal.summary}; history_context=enabled` : proposal.summary,
                operators: [],
                ...(proposal.adapterMetadata ? { adapterMetadata: proposal.adapterMetadata } : {}),
              },
              logs: {
                ...runRecord.logs,
                proposeStdoutPath,
              },
            },
            "proposed",
          );
          await dependencies.runStore.put(runRecord);
          break;
        }

        case "execute_experiment": {
          const workspacePath = requireWorkspacePath(runRecord);
          const experiment = await runExperiment(input.manifest.experiment.run, {
            workspacePath,
          });
          const runStdoutPath = await persistText(
            join(context.runDir, "logs", `${runRecord.candidateId}.experiment.stdout.log`),
            experiment.stdout,
          );

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
          break;
        }

        case "evaluate_metrics": {
          const workspacePath = requireWorkspacePath(runRecord);
          const metricEvaluation = await evaluateMetrics({
            repoRoot: input.repoRoot,
            manifestDir,
            manifest: input.manifest,
            currentFrontier: frontier,
            workspacePath,
            runDir: join(context.runDir, "judge", runRecord.candidateId),
            ...(dependencies.judgeProvider ? { judgeProvider: dependencies.judgeProvider } : {}),
          });
          const artifacts = await snapshotArtifacts(
            input.manifest.experiment.outputs,
            workspacePath,
            join(context.runDir, "artifacts", runRecord.candidateId),
          );
          const constraints = evaluateConstraints(input.manifest.constraints, metricEvaluation.metrics);
          const changeBudget = await evaluateChangeBudget({
            workspacePath,
            scope: input.manifest.scope,
          });
          lastChangeBudget = changeBudget;

          let ratchetDecision = resolveDecision({
            manifest: input.manifest,
            metrics: metricEvaluation.metrics,
            currentFrontier: frontier,
            constraints,
            changeBudget,
            priorConsecutiveAccepts,
          });

          lastAnchorCheck = undefined;
          if (ratchetDecision.outcome === "accepted") {
            lastAnchorCheck = metricEvaluation.anchorChecks.get(ratchetDecision.metricId);
            if (lastAnchorCheck) {
              const gated = applyAnchorAgreementGate(ratchetDecision.outcome, lastAnchorCheck);
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
              constraints: constraints.results.map(stripConstraintReason),
              artifacts,
            },
            "evaluated",
            {
              status: ratchetDecision.outcome,
            },
          );
          await dependencies.runStore.put(runRecord);
          break;
        }

        case "write_decision": {
          const decisionState = await buildDecisionState({
            input,
            dependencies,
            runRecord,
            frontier,
            priorConsecutiveAccepts,
            manifestDir,
            runDir: context.runDir,
          });
          lastChangeBudget = decisionState.changeBudget;
          lastAnchorCheck = decisionState.anchorCheck;

          const decisionId = `decision-${runRecord.runId}`;
          const decisionCreatedAt = now().toISOString();
          const candidateFrontierEntry = buildAcceptedFrontierEntry({
            runId: runRecord.runId,
            candidateId: runRecord.candidateId,
            acceptedAt: decisionCreatedAt,
            metrics: runRecord.metrics,
            artifacts: runRecord.artifacts,
          });
          const frontierUpdate = decisionState.ratchetDecision.outcome === "accepted"
            ? updateAcceptedFrontier(input.manifest, frontier, candidateFrontierEntry)
            : null;

          decisionRecord = {
            decisionId,
            runId: runRecord.runId,
            outcome: decisionState.ratchetDecision.outcome,
            actorType: "system",
            policyType: decisionState.ratchetDecision.policyType,
            metricId: decisionState.ratchetDecision.metricId,
            ...(decisionState.ratchetDecision.delta === undefined ? {} : { delta: decisionState.ratchetDecision.delta }),
            reason: decisionState.ratchetDecision.reason,
            createdAt: decisionCreatedAt,
            frontierChanged: frontierUpdate?.comparison.frontierChanged ?? false,
            beforeFrontierIds: frontier.map((entry) => entry.frontierId),
            afterFrontierIds: (frontierUpdate?.entries ?? frontier).map((entry) => entry.frontierId),
            auditRequired: false,
            ...(buildDecisionDiagnostics(runRecord.metrics[decisionState.ratchetDecision.metricId])
              ? { diagnostics: buildDecisionDiagnostics(runRecord.metrics[decisionState.ratchetDecision.metricId]) }
              : {}),
            ...(decisionState.ratchetDecision.graduation ? { graduation: decisionState.ratchetDecision.graduation } : {}),
          };
          if (decisionState.ratchetDecision.outcome === "accepted") {
            const promotion = await preparePromotionArtifact({
              candidateId: runRecord.candidateId,
              runDir: context.runDir,
              manifest: input.manifest,
              workspaceManager: dependencies.workspaceManager,
            });
            runRecord = {
              ...runRecord,
              proposal: {
                ...runRecord.proposal,
                patchPath: promotion.patchPath,
                changedPaths: promotion.changedPaths,
                filesChanged: promotion.changedPaths.length,
              },
            };
          }
          auditQueue = buildAuditQueue(
            decisionState.ratchetDecision.metricId,
            decisionRecord,
            input.manifest,
            decisionState.packByMetricId,
          );
          decisionRecord = {
            ...decisionRecord,
            auditRequired: auditQueue.length > 0,
          };
          await dependencies.decisionStore.put(decisionRecord);

          runRecord = advanceRunPhase(runRecord, "decision_written", {
            status: decisionState.ratchetDecision.outcome,
            decisionId,
          });
          await dependencies.runStore.put(runRecord);

          if (decisionState.ratchetDecision.outcome === "needs_human") {
            return {
              status: "needs_human",
              run: runRecord,
              decision: decisionRecord,
              frontier,
              auditQueue,
              ...(lastChangeBudget ? { changeBudget: lastChangeBudget } : {}),
              ...(lastAnchorCheck ? { anchorCheck: lastAnchorCheck } : {}),
            };
          }
          break;
        }

        case "commit_candidate": {
          if (runRecord.status !== "accepted") {
            throw new Error(`cannot commit candidate for non-accepted run ${runRecord.runId}`);
          }
          if (!decisionRecord) {
            decisionRecord = await requireDecisionRecord(dependencies.decisionStore, runRecord);
          }

          await dependencies.gitClient.applyPatchIfNeeded(requirePromotionPatch(runRecord));
          const commitResult = await dependencies.gitClient.stageAndCommitPaths(
            requirePromotionPaths(runRecord),
            `rrx: accept ${runRecord.runId}`,
          );
          decisionRecord = {
            ...decisionRecord,
            commitSha: commitResult.commitSha,
          };
          await dependencies.decisionStore.put(decisionRecord);

          runRecord = advanceRunPhase(runRecord, "committed");
          await dependencies.runStore.put(runRecord);
          break;
        }

        case "update_frontier": {
          if (!decisionRecord) {
            decisionRecord = await requireDecisionRecord(dependencies.decisionStore, runRecord);
          }
          if (!decisionRecord.commitSha) {
            throw new Error(`cannot update frontier for ${runRecord.runId}: missing commit sha`);
          }

          const candidateFrontierEntry = {
            ...buildAcceptedFrontierEntry({
              runId: runRecord.runId,
              candidateId: runRecord.candidateId,
              acceptedAt: decisionRecord.createdAt,
              metrics: runRecord.metrics,
              artifacts: runRecord.artifacts,
            }),
            commitSha: decisionRecord.commitSha,
          };
          frontier = updateAcceptedFrontier(input.manifest, frontier, candidateFrontierEntry).entries;

          await dependencies.frontierStore.save(frontier);
          runRecord = advanceRunPhase(runRecord, "frontier_updated");
          await dependencies.runStore.put(runRecord);
          break;
        }

        case "cleanup_workspace": {
          await dependencies.workspaceManager.cleanupWorkspace(runRecord.candidateId);
          runRecord = advanceRunPhase(runRecord, "completed", {
            status: runRecord.status,
          });
          await dependencies.runStore.put(runRecord);

          return {
            status: toCycleRunStatus(runRecord.status),
            run: runRecord,
            ...(decisionRecord ? { decision: decisionRecord } : {}),
            frontier,
            auditQueue,
            ...(lastChangeBudget ? { changeBudget: lastChangeBudget } : {}),
            ...(lastAnchorCheck ? { anchorCheck: lastAnchorCheck } : {}),
          };
        }

        case "none": {
          if (runRecord.status === "needs_human") {
            return {
              status: "needs_human",
              run: runRecord,
              ...(decisionRecord ? { decision: decisionRecord } : {}),
              frontier,
              auditQueue,
              ...(lastChangeBudget ? { changeBudget: lastChangeBudget } : {}),
              ...(lastAnchorCheck ? { anchorCheck: lastAnchorCheck } : {}),
            };
          }

          if (runRecord.phase === "completed") {
            return {
              status: toCycleRunStatus(runRecord.status),
              run: runRecord,
              ...(decisionRecord ? { decision: decisionRecord } : {}),
              frontier,
              auditQueue,
              ...(lastChangeBudget ? { changeBudget: lastChangeBudget } : {}),
              ...(lastAnchorCheck ? { anchorCheck: lastAnchorCheck } : {}),
            };
          }

          throw new Error(`run ${runRecord.runId} is missing a resumable next action`);
        }
      }
    }
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

function createRunContextFromRecord(
  repoRoot: string,
  manifest: RalphManifest,
  run: RunRecord,
): RunContext {
  return {
    runId: run.runId,
    cycle: run.cycle,
    candidateId: run.candidateId,
    runDir: join(resolve(repoRoot), manifest.storage.root, "runs", run.runId),
    startedAt: run.startedAt,
    manifestHash: run.manifestHash,
  };
}

async function buildDecisionState(input: {
  input: RunCycleInput;
  dependencies: CycleRunnerDependencies;
  runRecord: RunRecord;
  frontier: FrontierEntry[];
  priorConsecutiveAccepts: number;
  manifestDir: string;
  runDir: string;
}): Promise<{
  ratchetDecision: RatchetDecision;
  changeBudget: ChangeBudgetDecision;
  anchorCheck?: AnchorCheckResult;
  packByMetricId: Map<string, JudgePack>;
}> {
  const workspacePath = requireWorkspacePath(input.runRecord);
  const changeBudget = await evaluateChangeBudget({
    workspacePath,
    scope: input.input.manifest.scope,
  });
  const constraints = summarizeStoredConstraints(input.runRecord.constraints);
  const { anchorChecks, packByMetricId } = await evaluateStoredAnchorChecks({
    manifest: input.input.manifest,
    manifestDir: input.manifestDir,
    runDir: input.runDir,
    ...(input.dependencies.judgeProvider ? { judgeProvider: input.dependencies.judgeProvider } : {}),
  });

  let ratchetDecision = resolveDecision({
    manifest: input.input.manifest,
    metrics: input.runRecord.metrics,
    currentFrontier: input.frontier,
    constraints,
    changeBudget,
    priorConsecutiveAccepts: input.priorConsecutiveAccepts,
  });

  let anchorCheck: AnchorCheckResult | undefined;
  if (ratchetDecision.outcome === "accepted") {
    anchorCheck = anchorChecks.get(ratchetDecision.metricId);
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

  return {
    ratchetDecision,
    changeBudget,
    ...(anchorCheck ? { anchorCheck } : {}),
    packByMetricId,
  };
}

async function evaluateStoredAnchorChecks(input: {
  manifest: RalphManifest;
  manifestDir: string;
  runDir: string;
  judgeProvider?: JudgeProvider;
}): Promise<{
  anchorChecks: Map<string, AnchorCheckResult>;
  packByMetricId: Map<string, JudgePack>;
}> {
  const anchorChecks = new Map<string, AnchorCheckResult>();
  const packByMetricId = new Map<string, JudgePack>();
  const anchorCache = new Map<string, AnchorCheckResult>();

  for (const metricDefinition of input.manifest.metrics.catalog) {
    if (metricDefinition.extractor.type !== "llm_judge") {
      continue;
    }
    if (!input.judgeProvider) {
      throw new Error(`metric ${metricDefinition.id} requires a judge provider`);
    }

    const extractor = metricDefinition.extractor as LlmJudgeMetricExtractorConfig;
    const pack = getJudgePack(input.manifest, extractor.judgePack);
    packByMetricId.set(metricDefinition.id, pack);

    if (!anchorCache.has(pack.id)) {
      const anchors = pack.anchors
        ? await loadAnchorRecords(resolve(input.manifestDir, pack.anchors.path))
        : [];
      anchorCache.set(
        pack.id,
        await evaluateAnchorAgreement({
          pack,
          extractor,
          provider: input.judgeProvider,
          anchors,
        }),
      );
    }

    anchorChecks.set(metricDefinition.id, anchorCache.get(pack.id)!);
  }

  return {
    anchorChecks,
    packByMetricId,
  };
}

function summarizeStoredConstraints(
  constraints: RunRecord["constraints"],
): { passed: boolean; reason: string } {
  const failing = constraints.find((constraint) => !constraint.passed);
  if (!failing) {
    return {
      passed: true,
      reason: "all constraints satisfied",
    };
  }

  return {
    passed: false,
    reason: `constraint ${failing.metric} failed`,
  };
}

async function requireDecisionRecord(
  decisionStore: DecisionStore,
  run: RunRecord,
): Promise<DecisionRecord> {
  if (!run.decisionId) {
    throw new Error(`run ${run.runId} is missing a decision id`);
  }
  const decision = await decisionStore.get(run.decisionId);
  if (!decision) {
    throw new Error(`decision ${run.decisionId} was not found`);
  }
  return decision;
}

function requireWorkspacePath(run: RunRecord): string {
  if (!run.workspacePath) {
    throw new Error(`run ${run.runId} is missing a durable workspace path`);
  }
  return run.workspacePath;
}

function toCycleRunStatus(status: RunRecord["status"]): CycleRunStatus {
  if (status === "accepted" || status === "rejected" || status === "needs_human" || status === "failed") {
    return status;
  }

  throw new Error(`run ended without a terminal cycle status: ${status}`);
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

function createInitialRunRecord(
  manifest: RalphManifest,
  resolvedBaselineRef: string,
  workspacePath: string | undefined,
  context: RunContext,
): RunRecord {
  return {
    runId: context.runId,
    cycle: context.cycle,
    candidateId: context.candidateId,
    status: "running",
    phase: "started",
    pendingAction: "prepare_proposal",
    startedAt: context.startedAt,
    updatedAt: context.startedAt,
    currentStepStartedAt: context.startedAt,
    manifestHash: context.manifestHash,
    workspaceRef: resolvedBaselineRef,
    ...(workspacePath ? { workspacePath } : {}),
    proposal: {
      proposerType: manifest.proposer.type,
      summary: "proposal pending",
      operators:
        manifest.proposer.type === "operator_llm"
          ? manifest.proposer.operators
          : manifest.proposer.type === "parallel"
            ? []
            : [],
    },
    artifacts: [],
    metrics: {},
    constraints: [],
    logs: {},
  };
}

async function prepareCandidateAttempt(input: {
  repoRoot: string;
  manifestDir: string;
  manifest: RalphManifest;
  resolvedBaselineRef: string;
  runDir: string;
  workspaceManager: GitWorktreeWorkspaceManager;
  currentFrontier: FrontierEntry[];
  judgeProvider?: JudgeProvider;
  historyContext?: { summary: string; path: string };
  baseCandidateId: string;
  referenceMetric: string;
}): Promise<CandidateAttemptResult> {
  if (input.manifest.proposer.type === "parallel") {
    const selection = await runParallelProposers<LeafProposerConfig, CandidateAttemptResult>({
      strategies: input.manifest.proposer.strategies,
      pickBest: input.manifest.proposer.pickBest,
      referenceMetric: input.referenceMetric,
      execute: async (strategy, index) => {
        const candidateId = `${input.baseCandidateId}-p${String(index + 1).padStart(2, "0")}`;
        const candidate = await executeCandidateStrategy({
          repoRoot: input.repoRoot,
          manifestDir: input.manifestDir,
          manifest: input.manifest,
          resolvedBaselineRef: input.resolvedBaselineRef,
          proposer: strategy,
          candidateId,
          runDir: input.runDir,
          workspaceManager: input.workspaceManager,
          currentFrontier: input.currentFrontier,
          ...(input.judgeProvider ? { judgeProvider: input.judgeProvider } : {}),
          ...(input.historyContext ? { historyContext: input.historyContext } : {}),
        });
        return {
          strategyIndex: index,
          strategyType: strategy.type,
          candidate,
          metrics: candidate.metrics,
          summary: candidate.summary,
        };
      },
      ...(input.manifest.proposer.pickBest === "judge_pairwise"
        ? {
            comparePairwise: async (left, right) =>
              compareCandidateAttempts(
                {
                  manifest: input.manifest,
                  manifestDir: input.manifestDir,
                  referenceMetric: input.referenceMetric,
                  ...(input.judgeProvider ? { judgeProvider: input.judgeProvider } : {}),
                },
                left.candidate,
                right.candidate,
              ),
          }
        : {}),
    });

    const hydratedCandidates = selection.candidates.map((candidate) => ({
      ...candidate,
      metrics: candidate.candidate.metrics,
      summary: candidate.candidate.summary,
    }));
    const selected = hydratedCandidates.find((candidate) => candidate.strategyIndex === selection.selected.strategyIndex);
    if (!selected) {
      throw new Error("selected parallel candidate missing from candidate set");
    }

    await Promise.all(
      hydratedCandidates
        .filter((candidate) => candidate.strategyIndex !== selected.strategyIndex)
        .map((candidate) => input.workspaceManager.cleanupWorkspace(candidate.candidate.candidateId)),
    );

    return {
      ...selected.candidate,
      proposerType: "parallel",
      summary: `${selected.candidate.summary}; ${selection.selectionReason}`,
    };
  }

  return executeCandidateStrategy({
    repoRoot: input.repoRoot,
    manifestDir: input.manifestDir,
    manifest: input.manifest,
    resolvedBaselineRef: input.resolvedBaselineRef,
    proposer: input.manifest.proposer,
    candidateId: input.baseCandidateId,
    runDir: input.runDir,
    workspaceManager: input.workspaceManager,
    currentFrontier: input.currentFrontier,
    ...(input.historyContext ? { historyContext: input.historyContext } : {}),
    ...(input.judgeProvider ? { judgeProvider: input.judgeProvider } : {}),
  });
}

async function executeCandidateStrategy(input: {
  repoRoot: string;
  manifestDir: string;
  manifest: RalphManifest;
  resolvedBaselineRef: string;
  proposer: LeafProposerConfig;
  candidateId: string;
  runDir: string;
  workspaceManager: GitWorktreeWorkspaceManager;
  currentFrontier: FrontierEntry[];
  createProposerRunner?: typeof createProposerRunner;
  judgeProvider?: JudgeProvider;
  historyContext?: { summary: string; path: string };
}): Promise<CandidateAttemptResult> {
  const workspace = await input.workspaceManager.createWorkspace(input.candidateId, input.resolvedBaselineRef);
  const proposal = await executeProposal(
    input.proposer,
    workspace.workspacePath,
    input.createProposerRunner,
    input.historyContext,
  );
  const proposeStdoutPath = await persistText(
    join(input.runDir, "logs", `${input.candidateId}.propose.stdout.log`),
    proposal.stdout,
  );

  const experiment = await runExperiment(input.manifest.experiment.run, {
    workspacePath: workspace.workspacePath,
  });
  const runStdoutPath = await persistText(
    join(input.runDir, "logs", `${input.candidateId}.experiment.stdout.log`),
    experiment.stdout,
  );

  const metricEvaluation = await evaluateMetrics({
    repoRoot: input.repoRoot,
    manifestDir: input.manifestDir,
    manifest: input.manifest,
    currentFrontier: input.currentFrontier,
    workspacePath: workspace.workspacePath,
    runDir: join(input.runDir, "judge", input.candidateId),
    ...(input.judgeProvider ? { judgeProvider: input.judgeProvider } : {}),
  });

  const artifacts = await snapshotArtifacts(
    input.manifest.experiment.outputs,
    workspace.workspacePath,
    join(input.runDir, "artifacts", input.candidateId),
  );
  const constraints = evaluateConstraints(input.manifest.constraints, metricEvaluation.metrics);
  const changeBudget = await evaluateChangeBudget({
    workspacePath: workspace.workspacePath,
    scope: input.manifest.scope,
  });

  return {
    candidateId: input.candidateId,
    workspacePath: workspace.workspacePath,
    proposerType: input.proposer.type,
    operators: input.proposer.type === "operator_llm" ? input.proposer.operators : [],
    summary: input.historyContext ? `${proposal.summary}; history_context=enabled` : proposal.summary,
    ...(proposal.adapterMetadata ? { adapterMetadata: proposal.adapterMetadata } : {}),
    proposeStdoutPath,
    runStdoutPath,
    metrics: metricEvaluation.metrics,
    artifacts,
    constraints,
    changeBudget,
    anchorChecks: metricEvaluation.anchorChecks,
    packByMetricId: metricEvaluation.packByMetricId,
  };
}

async function executeProposal(
  proposer: LeafProposerConfig,
  workspacePath: string,
  buildProposerRunner: typeof createProposerRunner | undefined,
  historyContext?: { summary: string; path: string },
  codexSession?: CodexCliCycleSessionContext,
) {
  return (buildProposerRunner ?? createProposerRunner)(proposer).run({
    workspacePath,
    ...(codexSession ? { codexSession } : {}),
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

async function compareCandidateAttempts(
  input: {
    manifest: RalphManifest;
    manifestDir: string;
    judgeProvider?: JudgeProvider;
    referenceMetric: string;
  },
  left: CandidateAttemptResult,
  right: CandidateAttemptResult,
): Promise<"left" | "right" | "tie"> {
  const metricDefinition = input.manifest.metrics.catalog.find((metric) => metric.id === input.referenceMetric);
  if (!metricDefinition) {
    throw new Error(`missing reference metric definition ${input.referenceMetric}`);
  }

  if (
    metricDefinition.kind !== "llm_score" ||
    metricDefinition.extractor.type !== "llm_judge" ||
    metricDefinition.extractor.mode !== "pairwise"
  ) {
    return compareByMetric(left, right, input.referenceMetric);
  }

  if (!input.judgeProvider) {
    throw new Error("parallel proposer pickBest=judge_pairwise requires a judge provider");
  }

  const extractor = metricDefinition.extractor as LlmJudgeMetricExtractorConfig;
  const pack = getJudgePack(input.manifest, extractor.judgePack);
  const prompt = await buildJudgePrompt({
    repoRoot: process.cwd(),
    manifestDir: input.manifestDir,
    workspacePath: left.workspacePath,
    extractor,
    frontier: [
      {
        frontierId: `parallel-${right.candidateId}`,
        runId: `parallel-${right.candidateId}`,
        candidateId: right.candidateId,
        acceptedAt: new Date(0).toISOString(),
        metrics: right.metrics,
        artifacts: right.artifacts,
      },
    ],
  });

  const result = await runLlmJudgeMetric({
    metricId: metricDefinition.id,
    direction: metricDefinition.direction,
    extractor,
    pack,
    prompt,
    provider: input.judgeProvider,
  });

  const winner = result.details.winner;
  if (winner === "candidate") {
    return "left";
  }

  if (winner === "incumbent") {
    return "right";
  }

  return compareByMetric(left, right, input.referenceMetric);
}

function compareByMetric(
  left: CandidateAttemptResult,
  right: CandidateAttemptResult,
  metricId: string,
): "left" | "right" | "tie" {
  const leftMetric = left.metrics[metricId];
  const rightMetric = right.metrics[metricId];
  if (!leftMetric || !rightMetric) {
    throw new Error(`parallel proposer comparison requires metric "${metricId}" on both candidates`);
  }

  if (leftMetric.direction === "maximize") {
    if (leftMetric.value > rightMetric.value) {
      return "left";
    }
    if (leftMetric.value < rightMetric.value) {
      return "right";
    }
    return "tie";
  }

  if (leftMetric.value < rightMetric.value) {
    return "left";
  }
  if (leftMetric.value > rightMetric.value) {
    return "right";
  }
  return "tie";
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
  const referenceMetric = getReferenceMetric(input.manifest);
  if (!input.changeBudget.withinBudget) {
    return {
      outcome: input.changeBudget.outcome === "needs_human" ? "needs_human" : "rejected",
      frontierChanged: false,
      metricId: referenceMetric,
      policyType: input.manifest.ratchet.type,
      reason: input.changeBudget.reason,
    };
  }

  return evaluateRatchet({
    ratchet: input.manifest.ratchet,
    primaryMetric: referenceMetric,
    candidateMetrics: input.metrics,
    currentFrontier: input.currentFrontier,
    priorConsecutiveAccepts: input.priorConsecutiveAccepts,
    ...(input.manifest.frontier.strategy === "pareto"
      ? {
          paretoObjectives: input.manifest.frontier.objectives,
        }
      : {}),
    ...(input.constraints.passed ? {} : { constraintFailureReason: input.constraints.reason }),
  });
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

function buildDecisionDiagnostics(metric?: MetricResult): DecisionRecord["diagnostics"] | undefined {
  if (!metric) {
    return undefined;
  }

  const diagnostics = summarizeMetricDiagnostics(metric);
  if (!diagnostics) {
    return undefined;
  }

  return {
    reasons: diagnostics.reasons,
    ...(diagnostics.sourceMetricId ? { sourceMetricId: diagnostics.sourceMetricId } : {}),
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

function getReferenceMetric(manifest: RalphManifest): string {
  if (manifest.frontier.strategy === "single_best") {
    return manifest.frontier.primaryMetric;
  }

  return manifest.frontier.objectives[0]!.metric;
}
