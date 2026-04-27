import { join, resolve } from "node:path";

import { JsonFileDecisionStore } from "../../adapters/fs/json-file-decision-store.js";
import { JsonFileFrontierStore } from "../../adapters/fs/json-file-frontier-store.js";
import { JsonFileRunStore } from "../../adapters/fs/json-file-run-store.js";
import { loadManifestFromFile } from "../../adapters/fs/manifest-loader.js";
import { DEFAULT_MANIFEST_FILENAME } from "../../core/manifest/schema.js";
import { materializeFrontier } from "../../core/state/frontier-materializer.js";
import { evaluateStoppingTarget, type StoppingTargetStatus } from "../../core/state/stopping-target.js";
import type { RunCycleServiceDependencies, RunCycleServiceInput, RunCycleServiceResult } from "./run-cycle-service.js";
import { RunCycleService } from "./run-cycle-service.js";

export interface RunLoopServiceInput extends RunCycleServiceInput {
  cycles?: number;
  untilTarget?: boolean;
  untilNoImprove?: number;
}

export interface RunLoopServiceResult {
  ok: boolean;
  cycles: number | null;
  cyclesExecuted: number;
  stopReason: string;
  results: RunCycleServiceResult[];
  warnings: string[];
  target?: StoppingTargetStatus;
}

export class RunLoopService {
  private readonly cycleService: RunCycleService;

  public constructor(dependencies: RunCycleServiceDependencies = {}) {
    this.cycleService = new RunCycleService(dependencies);
  }

  public async run(input: RunLoopServiceInput): Promise<RunLoopServiceResult> {
    const repoRoot = resolve(input.repoRoot);
    const manifestPath = resolve(repoRoot, input.manifestPath ?? DEFAULT_MANIFEST_FILENAME);
    validatePositiveIntegerOption(input.cycles, "--cycles");
    validatePositiveIntegerOption(input.untilNoImprove, "--until-no-improve");

    const progressiveMode = Boolean(input.untilTarget) || input.untilNoImprove !== undefined;
    const exactCycles = progressiveMode ? null : input.cycles ?? 1;
    const maxCycles = progressiveMode ? input.cycles ?? null : exactCycles;

    const manifestState = await loadManifestState(repoRoot, manifestPath);
    const warnings = new Set<string>();
    const results: RunCycleServiceResult[] = [];
    let consecutiveNoImprove = 0;
    let targetStatus = manifestState.targetStatus;

    if (input.untilTarget && !targetStatus?.configured) {
      throw new Error("--until-target requires manifest.stopping.target");
    }

    if (input.untilTarget && targetStatus?.met) {
      return {
        ok: true,
        cycles: maxCycles,
        cyclesExecuted: 0,
        stopReason: targetStatus.reason,
        results,
        warnings: [],
        target: targetStatus,
      };
    }

    while (true) {
      if (!progressiveMode && results.length >= (exactCycles ?? 0)) {
        return {
          ok: true,
          cycles: exactCycles,
          cyclesExecuted: results.length,
          stopReason: `completed ${exactCycles} cycle(s)`,
          results,
          warnings: [...warnings],
          ...(targetStatus ? { target: targetStatus } : {}),
        };
      }

      if (progressiveMode && maxCycles !== null && results.length >= maxCycles) {
        return {
          ok: results.every((result) => result.status !== "failed"),
          cycles: maxCycles,
          cyclesExecuted: results.length,
          stopReason: buildMaxCycleStopReason(maxCycles, input.untilTarget, targetStatus),
          results,
          warnings: [...warnings],
          ...(targetStatus ? { target: targetStatus } : {}),
        };
      }

      const result = await this.cycleService.run({
        repoRoot,
        manifestPath,
        ...(input.fresh ? { fresh: input.fresh } : {}),
      });
      results.push(result);

      if (result.warning) {
        warnings.add(result.warning);
      }

      if (result.status === "failed") {
        return {
          ok: false,
          cycles: progressiveMode ? maxCycles : exactCycles,
          cyclesExecuted: results.length,
          stopReason: `cycle ${results.length} failed`,
          results,
          warnings: [...warnings],
          ...(targetStatus ? { target: targetStatus } : {}),
        };
      }

      const frontierChanged = result.runResult?.decision?.frontierChanged ?? false;
      consecutiveNoImprove = frontierChanged ? 0 : consecutiveNoImprove + 1;

      if (input.untilTarget) {
        targetStatus = evaluateStoppingTarget(manifestState.manifest, result.runResult?.frontier ?? []);
        if (targetStatus.met) {
          return {
            ok: true,
            cycles: progressiveMode ? maxCycles : exactCycles,
            cyclesExecuted: results.length,
            stopReason: targetStatus.reason,
            results,
            warnings: [...warnings],
            target: targetStatus,
          };
        }
      }

      if (result.status === "needs_human") {
        return {
          ok: true,
          cycles: progressiveMode ? maxCycles : exactCycles,
          cyclesExecuted: results.length,
          stopReason: `cycle ${results.length} requires manual review`,
          results,
          warnings: [...warnings],
          ...(targetStatus ? { target: targetStatus } : {}),
        };
      }

      if (input.untilNoImprove !== undefined && consecutiveNoImprove >= input.untilNoImprove) {
        return {
          ok: true,
          cycles: progressiveMode ? maxCycles : exactCycles,
          cyclesExecuted: results.length,
          stopReason: `stopped after ${consecutiveNoImprove} consecutive cycle(s) without frontier improvement`,
          results,
          warnings: [...warnings],
          ...(targetStatus ? { target: targetStatus } : {}),
        };
      }
    }
  }
}

async function loadManifestState(repoRoot: string, manifestPath: string): Promise<{
  manifest: Awaited<ReturnType<typeof loadManifestFromFile>>["manifest"];
  targetStatus?: StoppingTargetStatus;
}> {
  const loadedManifest = await loadManifestFromFile(manifestPath, { repoRoot });
  const storageRoot = join(repoRoot, loadedManifest.manifest.storage.root);
  const runStore = new JsonFileRunStore(join(storageRoot, "runs"));
  const decisionStore = new JsonFileDecisionStore(join(storageRoot, "decisions"));
  const frontierStore = new JsonFileFrontierStore(join(storageRoot, "frontier.json"));
  const frontier = await materializeFrontier({
    manifest: loadedManifest.manifest,
    frontierStore,
    runs: await runStore.list(),
    decisions: await decisionStore.list(),
    mode: "read_only",
  });

  return {
    manifest: loadedManifest.manifest,
    ...(loadedManifest.manifest.stopping.target
      ? { targetStatus: evaluateStoppingTarget(loadedManifest.manifest, frontier) }
      : {}),
  };
}

function validatePositiveIntegerOption(value: number | undefined, label: string): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} requires a positive integer`);
  }
}

function buildMaxCycleStopReason(
  maxCycles: number,
  untilTarget: boolean | undefined,
  targetStatus?: StoppingTargetStatus,
): string {
  if (untilTarget) {
    const targetText = targetStatus?.configured
      ? `${targetStatus.metricId} ${targetStatus.op} ${targetStatus.targetValue}`
      : "configured target";
    return `stopped after reaching max cycles (${maxCycles}) before ${targetText}`;
  }

  return `completed ${maxCycles} cycle(s)`;
}
