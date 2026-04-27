import { ZodError } from "zod";

import type { RalphManifest } from "../manifest/schema.js";
import type { DecisionRecord } from "../model/decision-record.js";
import type { FrontierEntry } from "../model/frontier-entry.js";
import type { RunRecord } from "../model/run-record.js";
import type { FrontierStore } from "../ports/frontier-store.js";
import { buildAcceptedFrontierEntry, updateAcceptedFrontier } from "./frontier-semantics.js";

export type FrontierMaterializationMode = "read_only" | "repair";

export async function materializeFrontier(input: {
  manifest: RalphManifest;
  frontierStore: FrontierStore;
  runs: RunRecord[];
  decisions: DecisionRecord[];
  mode: FrontierMaterializationMode;
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
  } catch (error) {
    if (!isRebuildableFrontierSnapshotError(error)) {
      throw error;
    }
  }

  if (input.mode === "read_only") {
    return rebuilt;
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
        ...buildAcceptedFrontierEntry({
          runId: run.runId,
          candidateId: run.candidateId,
          acceptedAt: decision.createdAt,
          metrics: run.metrics,
          artifacts: run.artifacts,
        }),
        commitSha: decision.commitSha,
      },
    ).entries;
  }

  return frontier;
}

function isRebuildableFrontierSnapshotError(error: unknown): boolean {
  return error instanceof SyntaxError || error instanceof ZodError;
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
  return updateAcceptedFrontier(manifest, currentFrontier, candidateEntry);
}
