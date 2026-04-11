import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireLock, releaseLock } from "../src/adapters/fs/lockfile.js";
import { JsonFileRunStore } from "../src/adapters/fs/json-file-run-store.js";
import { runInspectCommand } from "../src/cli/commands/inspect.js";
import { runStatusCommand } from "../src/cli/commands/status.js";
import { GitWorktreeWorkspaceManager } from "../src/core/engine/workspace-manager.js";
import type { RunRecord } from "../src/core/model/run-record.js";
import { createCapturingIo, initNumericFixtureRepo } from "./helpers/fixture-repo.js";

let tempRoot = "";
let originalCwd = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-status-inspect-"));
  originalCwd = process.cwd();
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("status and inspect recovery output", () => {
  it("shows recovery classification and next action in status output", async () => {
    const repoRoot = join(tempRoot, "repo-status");
    await initNumericFixtureRepo(repoRoot);
    await seedProposedRun(repoRoot);
    process.chdir(repoRoot);

    const io = createCapturingIo();
    const exitCode = await runStatusCommand({}, io);

    expect(exitCode).toBe(0);
    expect(io.stdoutText()).toContain("runtime: stale (resumable)");
    expect(io.stdoutText()).toContain("recovery: resumable (execute_experiment)");
    expect(io.stdoutText()).toContain("current step: execute_experiment");
  });

  it("shows a live runtime summary when the heartbeat is active", async () => {
    const repoRoot = join(tempRoot, "repo-status-alive");
    await initNumericFixtureRepo(repoRoot);
    await seedProposedRun(repoRoot);
    process.chdir(repoRoot);

    const lock = await acquireLock(join(repoRoot, ".ralph", "lock"), {
      owner: {
        operation: "run-cycle",
      },
    });

    try {
      const io = createCapturingIo();
      const exitCode = await runStatusCommand({}, io);

      expect(exitCode).toBe(0);
      expect(io.stdoutText()).toContain("runtime: running (alive)");
      expect(io.stdoutText()).toContain(`pid: ${process.pid}`);
      expect(io.stdoutText()).toContain("heartbeat:");
    } finally {
      await releaseLock(lock.path, lock.metadata.token);
    }
  });

  it("includes a dedicated recovery section in inspect JSON output", async () => {
    const repoRoot = join(tempRoot, "repo-inspect");
    await initNumericFixtureRepo(repoRoot);
    await seedCommittedRun(repoRoot);
    process.chdir(repoRoot);

    const io = createCapturingIo();
    const exitCode = await runInspectCommand("run-0001", { json: true }, io);

    expect(exitCode).toBe(0);
    const payload = JSON.parse(io.stdoutText());
    expect(payload.recovery).toMatchObject({
      classification: "repair_required",
      nextAction: "none",
      resumeAllowed: false,
    });
    expect(payload.recovery.reason).toContain("commit sha");
  });

  it("shows codex_cli proposer invocation metadata in status output", async () => {
    const repoRoot = join(tempRoot, "repo-status-codex-cli");
    await initNumericFixtureRepo(repoRoot);
    await seedCodexCliRun(repoRoot);
    process.chdir(repoRoot);

    const io = createCapturingIo();
    const exitCode = await runStatusCommand({}, io);

    expect(exitCode).toBe(0);
    expect(io.stdoutText()).toContain("latest proposer: codex_cli");
    expect(io.stdoutText()).toContain("latest proposer invocation: session session-001 via codex -C /tmp/workspace -a never -s workspace-write --search");
    expect(io.stdoutText()).toContain("latest proposer outcome: terminal_exit code=0 signal=none duration=1200ms");
  });

  it("shows codex_cli proposer invocation metadata in inspect output", async () => {
    const repoRoot = join(tempRoot, "repo-inspect-codex-cli");
    await initNumericFixtureRepo(repoRoot);
    await seedCodexCliRun(repoRoot);
    process.chdir(repoRoot);

    const io = createCapturingIo();
    const exitCode = await runInspectCommand("run-0001", {}, io);

    expect(exitCode).toBe(0);
    expect(io.stdoutText()).toContain("proposer: codex_cli");
    expect(io.stdoutText()).toContain("proposer invocation: session session-001 via codex -C /tmp/workspace -a never -s workspace-write --search");
    expect(io.stdoutText()).toContain("proposer outcome: terminal_exit code=0 signal=none duration=1200ms");
  });
});

async function seedProposedRun(repoRoot: string): Promise<void> {
  const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
  const workspaceManager = new GitWorktreeWorkspaceManager(repoRoot, join(repoRoot, ".ralph"));
  const workspace = await workspaceManager.createWorkspace("candidate-0001", "main");
  await writeFile(join(workspace.workspacePath, "docs", "draft.md"), "Recovered draft.\n", "utf8");
  const proposeLogDir = join(repoRoot, ".ralph", "runs", "run-0001", "logs");
  const proposeLogPath = join(proposeLogDir, "candidate-0001.propose.stdout.log");
  await mkdir(proposeLogDir, { recursive: true });
  await writeFile(proposeLogPath, "proposal complete\n", "utf8");

  await runStore.put(
    makeRunRecord({
      phase: "proposed",
      pendingAction: "execute_experiment",
      updatedAt: "2026-03-29T00:01:00.000Z",
      currentStepStartedAt: "2026-03-29T00:01:00.000Z",
      workspacePath: workspace.workspacePath,
      proposal: {
        proposerType: "command",
        summary: "Recovered proposal",
        operators: [],
      },
      logs: {
        proposeStdoutPath: proposeLogPath,
      },
    }),
  );
}

async function seedCommittedRun(repoRoot: string): Promise<void> {
  const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
  await runStore.put(
    makeRunRecord({
      status: "accepted",
      phase: "committed",
      pendingAction: "update_frontier",
      decisionId: "decision-run-0001",
    }),
  );
}

async function seedCodexCliRun(repoRoot: string): Promise<void> {
  const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
  await runStore.put(
    makeRunRecord({
      status: "rejected",
      phase: "completed",
      pendingAction: "none",
      endedAt: "2026-04-12T00:20:00.000Z",
      proposal: {
        proposerType: "codex_cli",
        summary: "codex_cli session session-001 completed with exit code 0 in 1200ms",
        operators: [],
        adapterMetadata: {
          adapter: "codex_cli",
          invocation: {
            sessionId: "session-001",
            command: "codex",
            args: ["-C", "/tmp/workspace", "-a", "never", "-s", "workspace-write", "--search"],
            cwd: "/tmp/workspace",
          },
          outcome: {
            kind: "terminal_exit",
            code: 0,
            signal: null,
            durationMs: 1200,
            summary: "codex_cli session session-001 completed with exit code 0 in 1200ms",
          },
        },
      },
    }),
  );
}

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-0001",
    cycle: 1,
    candidateId: "candidate-0001",
    status: "running",
    phase: "started",
    pendingAction: "prepare_proposal",
    startedAt: "2026-03-29T00:00:00.000Z",
    manifestHash: "manifest-hash",
    workspaceRef: "main",
    proposal: {
      proposerType: "command",
      summary: "proposal pending",
      operators: [],
    },
    artifacts: [],
    metrics: {},
    constraints: [],
    logs: {},
    ...overrides,
  };
}
