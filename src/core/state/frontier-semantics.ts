import type { RalphManifest } from "../manifest/schema.js";
import type { FrontierEntry } from "../model/frontier-entry.js";
import type { MetricResult } from "../model/metric.js";
import { updateParetoFrontier, updateSingleBestFrontier } from "./frontier-engine.js";

export function buildAcceptedFrontierEntry(input: {
  runId: string;
  candidateId: string;
  acceptedAt: string;
  metrics: Record<string, MetricResult>;
  artifacts: FrontierEntry["artifacts"];
}): FrontierEntry {
  return {
    frontierId: `frontier-${input.runId}`,
    runId: input.runId,
    candidateId: input.candidateId,
    acceptedAt: input.acceptedAt,
    metrics: input.metrics,
    artifacts: input.artifacts,
  };
}

export function updateAcceptedFrontier(
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

export function attachCommitShaToFrontierEntries(
  frontier: FrontierEntry[],
  runId: string,
  commitSha: string,
): FrontierEntry[] {
  return frontier.map((entry) =>
    entry.runId === runId
      ? {
          ...entry,
          commitSha,
        }
      : entry,
  );
}
