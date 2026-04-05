import { join, resolve } from "node:path";

import { JsonFileDecisionStore } from "../../adapters/fs/json-file-decision-store.js";
import { JsonFileFrontierStore } from "../../adapters/fs/json-file-frontier-store.js";
import { JsonFileRunStore } from "../../adapters/fs/json-file-run-store.js";
import { loadManifestFromFile } from "../../adapters/fs/manifest-loader.js";
import { DEFAULT_MANIFEST_FILENAME } from "../../core/manifest/schema.js";
import type { DecisionRecord } from "../../core/model/decision-record.js";
import type { FrontierEntry } from "../../core/model/frontier-entry.js";
import type { RunRecord } from "../../core/model/run-record.js";
import { materializeFrontier } from "../../core/state/frontier-materializer.js";
import { classifyRecovery, type RecoveryStatus } from "../../core/state/recovery-classifier.js";

export interface ProjectStateInput {
  repoRoot: string;
  manifestPath?: string;
}

export interface ProjectStatus {
  manifestPath: string;
  latestRun: RunRecord | null;
  recovery: RecoveryStatus;
  frontier: FrontierEntry[];
  pendingHumanRuns: RunRecord[];
  decisions: DecisionRecord[];
}

export interface InspectRunResult {
  manifestPath: string;
  run: RunRecord;
  decision: DecisionRecord | null;
  recovery: RecoveryStatus;
  frontier: FrontierEntry[];
  explainability: {
    decisionReason: string | null;
    judgeRationales: Array<{
      metricId: string;
      rationale: string;
      judgeTracePath?: string;
    }>;
    metricDeltas: Array<{
      metricId: string;
      value: number;
      delta?: number;
      confidence?: number;
      direction: "maximize" | "minimize";
    }>;
    diffSummary: {
      filesChanged?: number;
      lineDelta?: number;
      changedPaths?: string[];
      withinBudget?: boolean;
    };
  };
}

export class RunNotFoundError extends Error {
  public constructor(runId: string) {
    super(`Run ${runId} was not found`);
    this.name = "RunNotFoundError";
  }
}

export async function getProjectStatus(input: ProjectStateInput): Promise<ProjectStatus> {
  const { manifestPath, manifest, runStore, decisionStore, frontierStore } = await loadProjectStores(input);
  const runs = await runStore.list();
  const decisions = await decisionStore.list();
  const frontier = await materializeFrontier({
    manifest,
    frontierStore,
    runs,
    decisions,
  });
  const latestRun = runs.at(-1) ?? null;
  const latestDecision = latestRun?.decisionId
    ? decisions.find((decision) => decision.decisionId === latestRun.decisionId) ?? await decisionStore.get(latestRun.decisionId)
    : null;

  return {
    manifestPath,
    latestRun,
    recovery: classifyRecovery({
      latestRun,
      decision: latestDecision,
      frontier,
    }),
    frontier,
    pendingHumanRuns: runs.filter((run) => run.status === "needs_human"),
    decisions,
  };
}

export async function getProjectFrontier(input: ProjectStateInput): Promise<{
  manifestPath: string;
  frontier: FrontierEntry[];
}> {
  const { manifestPath, manifest, runStore, decisionStore, frontierStore } = await loadProjectStores(input);
  const runs = await runStore.list();
  const decisions = await decisionStore.list();
  return {
    manifestPath,
    frontier: await materializeFrontier({
      manifest,
      frontierStore,
      runs,
      decisions,
    }),
  };
}

export async function inspectRun(input: ProjectStateInput & { runId: string }): Promise<InspectRunResult> {
  const { manifestPath, manifest, runStore, decisionStore, frontierStore } = await loadProjectStores(input);
  const runs = await runStore.list();
  const decisions = await decisionStore.list();
  const run = await runStore.get(input.runId);
  if (!run) {
    throw new RunNotFoundError(input.runId);
  }

  const decision = run.decisionId ? await decisionStore.get(run.decisionId) : null;
  const frontier = await materializeFrontier({
    manifest,
    frontierStore,
    runs,
    decisions,
  });

  const judgeRationales = Object.values(run.metrics)
    .flatMap((metric) => {
      const rationale = typeof metric.details.rationale === "string" ? metric.details.rationale : null;
      if (!rationale) {
        return [];
      }

      return [
        {
          metricId: metric.metricId,
          rationale,
          ...(metric.judgeTracePath ? { judgeTracePath: metric.judgeTracePath } : {}),
        },
      ];
    });

  const metricDeltas = Object.values(run.metrics).map((metric) => ({
    metricId: metric.metricId,
    value: metric.value,
    direction: metric.direction,
    ...(metric.confidence === undefined ? {} : { confidence: metric.confidence }),
    ...(decision?.metricId === metric.metricId && decision.delta !== undefined ? { delta: decision.delta } : {}),
  }));

  return {
    manifestPath,
    run,
    decision,
    recovery: classifyRecovery({
      latestRun: run,
      decision,
      frontier,
    }),
    frontier,
    explainability: {
      decisionReason: decision?.reason ?? null,
      judgeRationales,
      metricDeltas,
      diffSummary: {
        ...(run.proposal.filesChanged === undefined ? {} : { filesChanged: run.proposal.filesChanged }),
        ...(run.proposal.diffLines === undefined ? {} : { lineDelta: run.proposal.diffLines }),
        ...(run.proposal.changedPaths ? { changedPaths: run.proposal.changedPaths } : {}),
        ...(run.proposal.withinBudget === undefined ? {} : { withinBudget: run.proposal.withinBudget }),
      },
    },
  };
}

async function loadProjectStores(input: ProjectStateInput) {
  const repoRoot = resolve(input.repoRoot);
  const manifestPath = resolve(repoRoot, input.manifestPath ?? DEFAULT_MANIFEST_FILENAME);
  const loadedManifest = await loadManifestFromFile(manifestPath);
  const storageRoot = join(repoRoot, loadedManifest.manifest.storage.root);

  return {
    manifestPath: loadedManifest.path,
    manifest: loadedManifest.manifest,
    runStore: new JsonFileRunStore(join(storageRoot, "runs")),
    decisionStore: new JsonFileDecisionStore(join(storageRoot, "decisions")),
    frontierStore: new JsonFileFrontierStore(join(storageRoot, "frontier.json")),
  };
}
