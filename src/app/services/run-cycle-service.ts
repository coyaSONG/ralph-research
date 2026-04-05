import { join, resolve } from "node:path";

import { JsonFileDecisionStore } from "../../adapters/fs/json-file-decision-store.js";
import { JsonFileFrontierStore } from "../../adapters/fs/json-file-frontier-store.js";
import { JsonFileRunStore } from "../../adapters/fs/json-file-run-store.js";
import { GitClient } from "../../adapters/git/git-client.js";
import { acquireLock, releaseLock, renewLock } from "../../adapters/fs/lockfile.js";
import { loadManifestFromFile } from "../../adapters/fs/manifest-loader.js";
import type { JudgeProvider } from "../../adapters/judge/llm-judge-provider.js";
import { DEFAULT_MANIFEST_FILENAME } from "../../core/manifest/schema.js";
import { DEFAULT_STORAGE_ROOT } from "../../core/manifest/defaults.js";
import { materializeFrontier } from "../../core/state/frontier-materializer.js";
import { classifyRecovery, type RecoveryStatus } from "../../core/state/recovery-classifier.js";
import { GitWorktreeWorkspaceManager } from "../../core/engine/workspace-manager.js";
import { runCycle, type CycleRunResult } from "../../core/engine/cycle-runner.js";

export interface RunCycleServiceInput {
  repoRoot: string;
  manifestPath?: string;
  fresh?: boolean;
}

export interface RunCycleServiceResult {
  status: CycleRunResult["status"];
  manifestPath: string;
  lockPath: string;
  runResult?: CycleRunResult;
  recovery?: RecoveryStatus;
  warning?: string;
}

export interface RunCycleServiceDependencies {
  judgeProvider?: JudgeProvider;
  now?: () => Date;
}

export class RunCycleService {
  private readonly judgeProvider: JudgeProvider | undefined;
  private readonly now: (() => Date) | undefined;

  public constructor(dependencies: RunCycleServiceDependencies = {}) {
    this.judgeProvider = dependencies.judgeProvider;
    this.now = dependencies.now;
  }

  public async run(input: RunCycleServiceInput): Promise<RunCycleServiceResult> {
    const repoRoot = resolve(input.repoRoot);
    const manifestPath = resolve(repoRoot, input.manifestPath ?? DEFAULT_MANIFEST_FILENAME);
    const lockPath = join(repoRoot, DEFAULT_STORAGE_ROOT, "lock");
    // Run the shared repo-aware admission check before taking locks or mutating storage.
    const loadedManifest = await loadManifestFromFile(manifestPath, { repoRoot });
    const lock = await acquireLock(lockPath, {
      owner: {
        operation: "run-cycle",
      },
    });
    const heartbeat = startLockHeartbeat(lock.path, lock.metadata.token, lock.metadata.ttlMs);

    try {
      const storageRoot = join(repoRoot, loadedManifest.manifest.storage.root);
      const runStore = new JsonFileRunStore(join(storageRoot, "runs"));
      const frontierStore = new JsonFileFrontierStore(join(storageRoot, "frontier.json"));
      const decisionStore = new JsonFileDecisionStore(join(storageRoot, "decisions"));

      const runs = await runStore.list();
      const decisions = await decisionStore.list();
      const latestRun = runs.at(-1);
      const frontier = await materializeFrontier({
        manifest: loadedManifest.manifest,
        frontierStore,
        runs,
        decisions,
      });
      const latestDecision = latestRun?.decisionId
        ? decisions.find((decision) => decision.decisionId === latestRun.decisionId) ?? await decisionStore.get(latestRun.decisionId)
        : null;
      const recovery = classifyRecovery({
        latestRun: latestRun ?? null,
        decision: latestDecision,
        frontier,
      });
      let warning: string | undefined;

      if (latestRun && !input.fresh) {
        if (recovery.classification === "resumable") {
          const workspaceManager = new GitWorktreeWorkspaceManager(repoRoot, storageRoot);
          const gitClient = new GitClient(repoRoot);
          const runResult = await runCycle(
            {
              repoRoot,
              manifestPath: loadedManifest.path,
              manifest: loadedManifest.manifest,
              resolvedBaselineRef: loadedManifest.resolvedBaselineRef,
              currentFrontier: frontier,
              resumeRun: latestRun,
            },
            {
              runStore,
              frontierStore,
              decisionStore,
              workspaceManager,
              gitClient,
              ...(this.judgeProvider ? { judgeProvider: this.judgeProvider } : {}),
              ...(this.now ? { now: this.now } : {}),
            },
          );

          return {
            status: runResult.status,
            manifestPath: loadedManifest.path,
            lockPath,
            runResult,
            recovery,
          };
        }

        if (recovery.classification === "manual_review_blocked") {
          throw new Error(`Latest run ${latestRun.runId} is waiting for manual review`);
        }

        if (recovery.classification === "repair_required") {
          warning = `Latest run ${latestRun.runId} requires repair: ${recovery.reason}. Starting a fresh run.`;
        }
      }

      const workspaceManager = new GitWorktreeWorkspaceManager(repoRoot, storageRoot);
      const gitClient = new GitClient(repoRoot);
      const runResult = await runCycle(
        {
          repoRoot,
          manifestPath: loadedManifest.path,
          manifest: loadedManifest.manifest,
          resolvedBaselineRef: loadedManifest.resolvedBaselineRef,
          currentFrontier: frontier,
        },
        {
          runStore,
          frontierStore,
          decisionStore,
          workspaceManager,
          gitClient,
          ...(this.judgeProvider ? { judgeProvider: this.judgeProvider } : {}),
          ...(this.now ? { now: this.now } : {}),
        },
      );

      return {
        status: runResult.status,
        manifestPath: loadedManifest.path,
        lockPath,
        runResult,
        ...(warning ? { warning } : {}),
        ...(latestRun ? { recovery } : {}),
      };
    } finally {
      heartbeat.stop();
      await releaseLock(lock.path, lock.metadata.token);
    }
  }
}

function startLockHeartbeat(path: string, token: string, ttlMs: number) {
  const intervalMs = Math.max(1_000, Math.floor(ttlMs / 2));
  const timer = setInterval(() => {
    void renewLock(path, token).catch(() => {
      clearInterval(timer);
    });
  }, intervalMs);
  timer.unref();

  return {
    stop: () => {
      clearInterval(timer);
    },
  };
}
