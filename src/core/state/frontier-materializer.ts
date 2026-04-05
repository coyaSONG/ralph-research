import type { RalphManifest } from "../manifest/schema.js";
import type { DecisionRecord } from "../model/decision-record.js";
import type { FrontierEntry } from "../model/frontier-entry.js";
import type { RunRecord } from "../model/run-record.js";
import type { FrontierStore } from "../ports/frontier-store.js";
import { updateParetoFrontier, updateSingleBestFrontier } from "./frontier-engine.js";

export async function materializeFrontier(input: {
  manifest: RalphManifest;
  frontierStore: FrontierStore;
  runs: RunRecord[];
  decisions: DecisionRecord[];
}): Promise<FrontierEntry[]> {
  const hasDurableAcceptedDecisions = input.decisions.some((decision) => decision.outcome === "accepted" && decision.commitSha);
  const rebuilt = rebuildFrontierFromRecords(input.manifest, input.runs, input.decisions);

  try {
    const snapshot = await input.frontierStore.load();
    if (frontiersMatch(snapshot, rebuilt)) {
      return snapshot;
    }
    if (!hasDurableAcceptedDecisions && rebuilt.length === 0 && snapshot.length > 0) {
      return snapshot;
    }
  } catch {
    // Rebuild below from durable records.
  }

  await input.frontierStore.save(rebuilt);
  return rebuilt;
}

export function rebuildFrontierFromRecords(
  manifest: RalphManifest,
  runs: RunRecord[],
  decisions: DecisionRecord[],
): FrontierEntry[] {
  const runById = new Map(runs.map((run) => [run.runId, run]));
  const acceptedDecisions = decisions
    .filter((decision) => decision.outcome === "accepted" && decision.commitSha)
    .sort((left, right) => {
      if (left.createdAt !== right.createdAt) {
        return left.createdAt.localeCompare(right.createdAt);
      }
      return left.decisionId.localeCompare(right.decisionId);
    });

  let frontier: FrontierEntry[] = [];

  for (const decision of acceptedDecisions) {
    const run = runById.get(decision.runId);
    if (!run) {
      throw new Error(`cannot rebuild frontier: missing run ${decision.runId} for accepted decision ${decision.decisionId}`);
    }

    frontier = updateFrontier(
      manifest,
      frontier,
      {
        frontierId: `frontier-${run.runId}`,
        runId: run.runId,
        candidateId: run.candidateId,
        acceptedAt: decision.createdAt,
        commitSha: decision.commitSha,
        metrics: run.metrics,
        artifacts: run.artifacts,
      },
    ).entries;
  }

  return frontier;
}

function frontiersMatch(current: FrontierEntry[], rebuilt: FrontierEntry[]): boolean {
  if (current.length !== rebuilt.length) {
    return false;
  }

  return current.every((entry, index) => {
    const candidate = rebuilt[index];
    if (!candidate) {
      return false;
    }

    return JSON.stringify(stripVolatileFields(entry)) === JSON.stringify(stripVolatileFields(candidate));
  });
}

function stripVolatileFields(entry: FrontierEntry) {
  return {
    frontierId: entry.frontierId,
    runId: entry.runId,
    candidateId: entry.candidateId,
    commitSha: entry.commitSha,
    metrics: entry.metrics,
    artifacts: entry.artifacts,
  };
}

function updateFrontier(
  manifest: RalphManifest,
  currentFrontier: FrontierEntry[],
  candidateEntry: FrontierEntry,
) {
  if (manifest.frontier.strategy === "single_best") {
    return updateSingleBestFrontier(currentFrontier, candidateEntry, manifest.frontier.primaryMetric);
  }

  return updateParetoFrontier(
    currentFrontier,
    candidateEntry,
    manifest.frontier.objectives,
    manifest.frontier.tieBreaker,
    manifest.frontier.referencePoint,
  );
}
