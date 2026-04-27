import { join, resolve } from "node:path";

import { JsonFileDecisionStore } from "../../adapters/fs/json-file-decision-store.js";
import { JsonFileFrontierStore } from "../../adapters/fs/json-file-frontier-store.js";
import { JsonFileRunStore } from "../../adapters/fs/json-file-run-store.js";
import { inspectLock, type LockRuntimeState } from "../../adapters/fs/lockfile.js";
import { loadManifestFromFile } from "../../adapters/fs/manifest-loader.js";
import { DEFAULT_MANIFEST_FILENAME } from "../../core/manifest/schema.js";
import { summarizeMetricDiagnostics } from "../../core/model/metric-diagnostics.js";
import type { DecisionRecord } from "../../core/model/decision-record.js";
import type { FrontierEntry } from "../../core/model/frontier-entry.js";
import type { PendingAction, RunRecord } from "../../core/model/run-record.js";
import { materializeFrontier } from "../../core/state/frontier-materializer.js";
import { classifyRecovery, derivePendingAction, type RecoveryStatus } from "../../core/state/recovery-classifier.js";

export interface ProjectStateInput {
  repoRoot: string;
  manifestPath?: string;
}

export interface ProjectStatus {
  manifestPath: string;
  latestRun: RunRecord | null;
  recovery: RecoveryStatus;
  runtime: ProjectRuntimeStatus;
  frontier: FrontierEntry[];
  pendingHumanRuns: RunRecord[];
  decisions: DecisionRecord[];
}

export type RuntimeState = "idle" | "running" | "stale" | "stopped";

export interface ProjectRuntimeStatus {
  state: RuntimeState;
  processAlive: boolean;
  stale: boolean;
  resumable: boolean;
  reason: string;
  lockPath: string;
  pid?: number;
  lastHeartbeatAt?: string;
  heartbeatAgeMs?: number;
  currentStep: PendingAction;
  currentStepStartedAt?: string;
  lastProgressAt?: string;
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
      sourceMetricId?: string;
    }>;
    metricDiagnostics: Array<{
      metricId: string;
      sourceMetricId?: string;
      reasons: string[];
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
  const { manifestPath, manifest, runStore, decisionStore, frontierStore, lockPath } = await loadProjectStores(input);
  const runs = await runStore.list();
  const decisions = await decisionStore.list();
  const frontier = await materializeFrontier({
    manifest,
    frontierStore,
    runs,
    decisions,
    mode: "read_only",
  });
  const latestRun = runs.at(-1) ?? null;
  const latestDecision = latestRun?.decisionId
    ? decisions.find((decision) => decision.decisionId === latestRun.decisionId) ?? await decisionStore.get(latestRun.decisionId)
    : null;
  const recovery = classifyRecovery({
    latestRun,
    decision: latestDecision,
    frontier,
  });
  const lockRuntime = await inspectLock(lockPath);

  return {
    manifestPath,
    latestRun,
    recovery,
    runtime: describeRuntime({
      latestRun,
      recovery,
      lockPath,
      lockRuntime,
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
      mode: "read_only",
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
    mode: "read_only",
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

  const metricDeltas = Object.values(run.metrics).map((metric) => {
    const diagnostics = summarizeMetricDiagnostics(metric);

    return {
      metricId: metric.metricId,
      value: metric.value,
      direction: metric.direction,
      ...(metric.confidence === undefined ? {} : { confidence: metric.confidence }),
      ...(diagnostics?.sourceMetricId ? { sourceMetricId: diagnostics.sourceMetricId } : {}),
      ...(decision?.metricId === metric.metricId && decision.delta !== undefined ? { delta: decision.delta } : {}),
    };
  });
  const metricDiagnostics = Object.values(run.metrics)
    .map((metric) => {
      const diagnostics = summarizeMetricDiagnostics(metric);
      if (!diagnostics) {
        return null;
      }

      return {
        metricId: metric.metricId,
        reasons: diagnostics.reasons,
        ...(diagnostics.sourceMetricId ? { sourceMetricId: diagnostics.sourceMetricId } : {}),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

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
      metricDiagnostics,
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
  const loadedManifest = await loadManifestFromFile(manifestPath, { repoRoot });
  const storageRoot = join(repoRoot, loadedManifest.manifest.storage.root);

  return {
    manifestPath: loadedManifest.path,
    manifest: loadedManifest.manifest,
    lockPath: join(storageRoot, "lock"),
    runStore: new JsonFileRunStore(join(storageRoot, "runs")),
    decisionStore: new JsonFileDecisionStore(join(storageRoot, "decisions")),
    frontierStore: new JsonFileFrontierStore(join(storageRoot, "frontier.json")),
  };
}

function describeRuntime(input: {
  latestRun: RunRecord | null;
  recovery: RecoveryStatus;
  lockPath: string;
  lockRuntime: LockRuntimeState | null;
}): ProjectRuntimeStatus {
  const currentStep = getCurrentStep(input.latestRun);
  const lastProgressAt = input.latestRun
    ? input.latestRun.updatedAt ?? input.latestRun.endedAt ?? input.latestRun.startedAt
    : undefined;
  const currentStepStartedAt = input.latestRun
    ? input.latestRun.currentStepStartedAt ?? input.latestRun.updatedAt ?? input.latestRun.startedAt
    : undefined;
  const processAlive = input.lockRuntime?.processAlive ?? false;
  const stale = input.lockRuntime?.stale ?? false;
  const runCycleLock = input.lockRuntime
    ? (input.lockRuntime.metadata.owner?.operation ?? "run-cycle") === "run-cycle"
    : false;

  if (input.recovery.classification === "resumable") {
    if (processAlive && !stale && runCycleLock) {
      return {
        state: "running",
        processAlive,
        stale: false,
        resumable: true,
        reason: "live run-cycle heartbeat present",
        lockPath: input.lockPath,
        currentStep,
        ...(input.lockRuntime ? buildLockDetails(input.lockRuntime) : {}),
        ...(currentStepStartedAt ? { currentStepStartedAt } : {}),
        ...(lastProgressAt ? { lastProgressAt } : {}),
      };
    }

    return {
      state: "stale",
      processAlive,
      stale: true,
      resumable: true,
      reason: "latest run is resumable but no live run-cycle heartbeat is present",
      lockPath: input.lockPath,
      currentStep,
      ...(input.lockRuntime ? buildLockDetails(input.lockRuntime) : {}),
      ...(currentStepStartedAt ? { currentStepStartedAt } : {}),
      ...(lastProgressAt ? { lastProgressAt } : {}),
    };
  }

  if (input.recovery.classification === "manual_review_blocked") {
    return {
      state: "stopped",
      processAlive,
      stale,
      resumable: false,
      reason: "manual review blocked",
      lockPath: input.lockPath,
      currentStep: "none",
      ...(input.lockRuntime ? buildLockDetails(input.lockRuntime) : {}),
      ...(lastProgressAt ? { lastProgressAt } : {}),
    };
  }

  if (input.recovery.classification === "repair_required") {
    return {
      state: "stopped",
      processAlive,
      stale,
      resumable: false,
      reason: "repair required",
      lockPath: input.lockPath,
      currentStep: "none",
      ...(input.lockRuntime ? buildLockDetails(input.lockRuntime) : {}),
      ...(lastProgressAt ? { lastProgressAt } : {}),
    };
  }

  return {
    state: "idle",
    processAlive,
    stale,
    resumable: false,
    reason: "no live run is expected",
    lockPath: input.lockPath,
    currentStep: "none",
    ...(input.lockRuntime ? buildLockDetails(input.lockRuntime) : {}),
    ...(lastProgressAt ? { lastProgressAt } : {}),
  };
}

function getCurrentStep(run: RunRecord | null): PendingAction {
  if (!run) {
    return "none";
  }

  return run.pendingAction !== "none" ? run.pendingAction : derivePendingAction(run);
}

function buildLockDetails(lockRuntime: LockRuntimeState): Pick<ProjectRuntimeStatus, "pid" | "lastHeartbeatAt" | "heartbeatAgeMs"> {
  return {
    pid: lockRuntime.metadata.pid,
    lastHeartbeatAt: lockRuntime.metadata.updatedAt,
    heartbeatAgeMs: lockRuntime.heartbeatAgeMs,
  };
}
