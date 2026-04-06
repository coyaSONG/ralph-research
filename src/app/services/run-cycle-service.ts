import { join, relative, resolve } from "node:path";

import { execa } from "execa";

import { JsonFileDecisionStore } from "../../adapters/fs/json-file-decision-store.js";
import { JsonFileFrontierStore } from "../../adapters/fs/json-file-frontier-store.js";
import { JsonFileRunStore } from "../../adapters/fs/json-file-run-store.js";
import { GitClient } from "../../adapters/git/git-client.js";
import { acquireLock, releaseLock, renewLock } from "../../adapters/fs/lockfile.js";
import { loadManifestFromFile } from "../../adapters/fs/manifest-loader.js";
import type { JudgeProvider } from "../../adapters/judge/llm-judge-provider.js";
import { DEFAULT_MANIFEST_FILENAME, type CommandSpecConfig, type RalphManifest } from "../../core/manifest/schema.js";
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
      const warnings: string[] = [];
      const workspaceWarning = await collectGitWorkspaceCommandWarning(repoRoot, loadedManifest.manifest);
      if (workspaceWarning) {
        warnings.push(workspaceWarning);
      }

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
            ...(warnings.length > 0 ? { warning: warnings.join("\n") } : {}),
          };
        }

        if (recovery.classification === "manual_review_blocked") {
          throw new Error(`Latest run ${latestRun.runId} is waiting for manual review`);
        }

        if (recovery.classification === "repair_required") {
          warnings.push(`Latest run ${latestRun.runId} requires repair: ${recovery.reason}. Starting a fresh run.`);
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
        ...(warnings.length > 0 ? { warning: warnings.join("\n") } : {}),
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

async function collectGitWorkspaceCommandWarning(
  repoRoot: string,
  manifest: RalphManifest,
): Promise<string | undefined> {
  if (manifest.project.workspace !== "git") {
    return undefined;
  }

  const candidates = collectManifestCommandFiles(repoRoot, manifest);
  if (candidates.length === 0) {
    return undefined;
  }

  const commandPaths = [...new Set(candidates.map((candidate) => candidate.relativePath))];
  const { stdout } = await execa("git", ["-C", repoRoot, "status", "--short", "--", ...commandPaths], {
    reject: false,
  });
  const dirtyPaths = new Set(
    stdout
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => line.slice(3).trim()),
  );
  if (dirtyPaths.size === 0) {
    return undefined;
  }

  const dirtyCandidates = candidates.filter((candidate) => dirtyPaths.has(candidate.relativePath));
  if (dirtyCandidates.length === 0) {
    return undefined;
  }

  const details = dirtyCandidates.map((candidate) => `${candidate.relativePath} (${candidate.role})`).join(", ");
  return `Git workspace commands with uncommitted changes will be ignored inside candidate worktrees until committed: ${details}`;
}

function collectManifestCommandFiles(
  repoRoot: string,
  manifest: RalphManifest,
): Array<{ relativePath: string; role: string }> {
  const candidates: Array<{ relativePath: string; role: string }> = [];

  const addCommandFile = (command: CommandSpecConfig, role: string) => {
    const token = extractCommandFileToken(command.command);
    if (!token) {
      return;
    }

    const baseDir = resolve(repoRoot, command.cwd ?? ".");
    const resolvedPath = resolve(baseDir, token);
    const relativePath = relative(repoRoot, resolvedPath);
    if (relativePath.startsWith("..")) {
      return;
    }

    candidates.push({
      relativePath,
      role,
    });
  };

  if (manifest.proposer.type === "command") {
    addCommandFile(manifest.proposer, "proposer");
  } else if (manifest.proposer.type === "parallel") {
    for (const [index, strategy] of manifest.proposer.strategies.entries()) {
      if (strategy.type === "command") {
        addCommandFile(strategy, `proposer strategy ${index + 1}`);
      }
    }
  }

  addCommandFile(manifest.experiment.run, "experiment");

  for (const metric of manifest.metrics.catalog) {
    if (metric.extractor.type === "command") {
      addCommandFile(metric.extractor, `metric ${metric.id}`);
    }
  }

  return candidates;
}

function extractCommandFileToken(command: string): string | undefined {
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? [];
  if (tokens.length === 0) {
    return undefined;
  }

  const first = tokens[0];
  const second = tokens[1];

  if (first && looksLikeFilePath(first)) {
    return first;
  }

  if (first && looksLikeInterpreter(first) && second && looksLikeFilePath(second)) {
    return second;
  }

  return undefined;
}

function looksLikeInterpreter(token: string): boolean {
  return ["node", "tsx", "python", "python3", "bash", "sh"].includes(token);
}

function looksLikeFilePath(token: string): boolean {
  return token.startsWith("/")
    || token.startsWith("./")
    || token.startsWith("../")
    || token.includes("/")
    || /\.(?:mjs|cjs|js|ts|tsx|py|sh|bash)$/.test(token);
}
