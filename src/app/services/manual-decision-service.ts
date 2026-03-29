import { join, resolve } from "node:path";

import { JsonFileDecisionStore } from "../../adapters/fs/json-file-decision-store.js";
import { JsonFileFrontierStore } from "../../adapters/fs/json-file-frontier-store.js";
import { JsonFileRunStore } from "../../adapters/fs/json-file-run-store.js";
import { acquireLock, releaseLock } from "../../adapters/fs/lockfile.js";
import { loadManifestFromFile } from "../../adapters/fs/manifest-loader.js";
import { GitClient } from "../../adapters/git/git-client.js";
import { DEFAULT_STORAGE_ROOT } from "../../core/manifest/defaults.js";
import { DEFAULT_MANIFEST_FILENAME, type RalphManifest } from "../../core/manifest/schema.js";
import type { DecisionRecord } from "../../core/model/decision-record.js";
import type { FrontierEntry } from "../../core/model/frontier-entry.js";
import type { RunRecord } from "../../core/model/run-record.js";
import { advanceRunPhase } from "../../core/state/run-state-machine.js";
import { GitWorktreeWorkspaceManager } from "../../core/engine/workspace-manager.js";

export interface ManualDecisionInput {
  repoRoot: string;
  runId: string;
  manifestPath?: string;
  note?: string;
  by?: string;
}

export interface ManualDecisionResult {
  status: "accepted" | "rejected";
  run: RunRecord;
  decision: DecisionRecord;
  frontier: FrontierEntry[];
}

export class ManualDecisionService {
  public async accept(input: ManualDecisionInput): Promise<ManualDecisionResult> {
    const repoRoot = resolve(input.repoRoot);
    const manifestPath = resolve(repoRoot, input.manifestPath ?? DEFAULT_MANIFEST_FILENAME);
    const lockPath = join(repoRoot, DEFAULT_STORAGE_ROOT, "lock");
    const lock = await acquireLock(lockPath);

    try {
      const { manifest } = await loadManifestFromFile(manifestPath);
      const storageRoot = join(repoRoot, manifest.storage.root);
      const runStore = new JsonFileRunStore(join(storageRoot, "runs"));
      const decisionStore = new JsonFileDecisionStore(join(storageRoot, "decisions"));
      const frontierStore = new JsonFileFrontierStore(join(storageRoot, "frontier.json"));
      const workspaceManager = new GitWorktreeWorkspaceManager(repoRoot, storageRoot);
      const gitClient = new GitClient(repoRoot);

      const run = await requirePendingHumanRun(runStore, input.runId);
      const decision = await requireDecision(decisionStore, run);
      const promoted = await workspaceManager.promoteWorkspace(run.candidateId, {
        excludePaths: manifest.experiment.outputs.map((output) => output.path),
      });
      const commitResult = await gitClient.stageAndCommitPaths(
        [...promoted.copiedPaths, ...promoted.deletedPaths],
        `rrx: accept ${run.runId}`,
      );

      const acceptedDecision: DecisionRecord = {
        ...decision,
        outcome: "accepted",
        actorType: "human",
        ...(input.by ? { actorId: input.by } : {}),
        reason: appendHumanDecisionReason(decision.reason, "accepted", input),
        frontierChanged: true,
        afterFrontierIds: [`frontier-${run.runId}`],
        commitSha: commitResult.commitSha,
      };
      await decisionStore.put(acceptedDecision);

      const acceptedFrontier = [
        buildManualFrontierEntry(run, commitResult.commitSha),
      ];
      await frontierStore.save(acceptedFrontier);

      const updatedRun = advanceRunPhase(run, "completed", {
        status: "accepted",
        decisionId: acceptedDecision.decisionId,
      });
      await runStore.put(updatedRun);
      await workspaceManager.cleanupWorkspace(run.candidateId);

      return {
        status: "accepted",
        run: updatedRun,
        decision: acceptedDecision,
        frontier: acceptedFrontier,
      };
    } finally {
      await releaseLock(lock.path, lock.metadata.token);
    }
  }

  public async reject(input: ManualDecisionInput): Promise<ManualDecisionResult> {
    const repoRoot = resolve(input.repoRoot);
    const manifestPath = resolve(repoRoot, input.manifestPath ?? DEFAULT_MANIFEST_FILENAME);
    const lockPath = join(repoRoot, DEFAULT_STORAGE_ROOT, "lock");
    const lock = await acquireLock(lockPath);

    try {
      const { manifest } = await loadManifestFromFile(manifestPath);
      const storageRoot = join(repoRoot, manifest.storage.root);
      const runStore = new JsonFileRunStore(join(storageRoot, "runs"));
      const decisionStore = new JsonFileDecisionStore(join(storageRoot, "decisions"));
      const frontierStore = new JsonFileFrontierStore(join(storageRoot, "frontier.json"));
      const workspaceManager = new GitWorktreeWorkspaceManager(repoRoot, storageRoot);

      const run = await requirePendingHumanRun(runStore, input.runId);
      const decision = await requireDecision(decisionStore, run);
      const currentFrontier = await frontierStore.load();

      const rejectedDecision: DecisionRecord = {
        ...decision,
        outcome: "rejected",
        actorType: "human",
        ...(input.by ? { actorId: input.by } : {}),
        reason: appendHumanDecisionReason(decision.reason, "rejected", input),
        frontierChanged: false,
        afterFrontierIds: currentFrontier.map((entry) => entry.frontierId),
      };
      await decisionStore.put(rejectedDecision);

      const updatedRun = advanceRunPhase(run, "completed", {
        status: "rejected",
        decisionId: rejectedDecision.decisionId,
      });
      await runStore.put(updatedRun);
      await workspaceManager.cleanupWorkspace(run.candidateId);

      return {
        status: "rejected",
        run: updatedRun,
        decision: rejectedDecision,
        frontier: currentFrontier,
      };
    } finally {
      await releaseLock(lock.path, lock.metadata.token);
    }
  }
}

async function requirePendingHumanRun(runStore: JsonFileRunStore, runId: string): Promise<RunRecord> {
  const run = await runStore.get(runId);
  if (!run) {
    throw new Error(`Run ${runId} was not found`);
  }
  if (run.status !== "needs_human") {
    throw new Error(`Run ${runId} is not pending human review`);
  }
  return run;
}

async function requireDecision(decisionStore: JsonFileDecisionStore, run: RunRecord): Promise<DecisionRecord> {
  if (!run.decisionId) {
    throw new Error(`Run ${run.runId} does not have a decision record`);
  }
  const decision = await decisionStore.get(run.decisionId);
  if (!decision) {
    throw new Error(`Decision ${run.decisionId} was not found`);
  }
  return decision;
}

function appendHumanDecisionReason(
  existingReason: string,
  outcome: "accepted" | "rejected",
  input: ManualDecisionInput,
): string {
  const by = input.by ? ` by ${input.by}` : "";
  const note = input.note ? `; note=${input.note}` : "";
  return `${existingReason}; human ${outcome}${by}${note}`;
}

function buildManualFrontierEntry(run: RunRecord, commitSha: string): FrontierEntry {
  return {
    frontierId: `frontier-${run.runId}`,
    runId: run.runId,
    candidateId: run.candidateId,
    acceptedAt: new Date().toISOString(),
    commitSha,
    metrics: run.metrics,
    artifacts: run.artifacts,
  };
}
