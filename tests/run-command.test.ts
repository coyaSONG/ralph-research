import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonFileRunStore } from "../src/adapters/fs/json-file-run-store.js";
import { runRunCommand } from "../src/cli/commands/run.js";
import { GitWorktreeWorkspaceManager } from "../src/core/engine/workspace-manager.js";
import type { RunRecord } from "../src/core/model/run-record.js";
import { createCapturingIo, initNumericFixtureRepo } from "./helpers/fixture-repo.js";

let tempRoot = "";
let originalCwd = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-run-command-"));
  originalCwd = process.cwd();
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("run command recovery contract", () => {
  it("auto-resumes the latest recoverable run on the same runId", async () => {
    const repoRoot = join(tempRoot, "repo-auto-resume");
    await initNumericFixtureRepo(repoRoot);
    await seedProposedRun(repoRoot, {
      runId: "run-0001",
      cycle: 1,
      candidateId: "candidate-0001",
    });
    process.chdir(repoRoot);

    const io = createCapturingIo();
    const exitCode = await runRunCommand({ json: true }, io);

    expect(exitCode).toBe(0);
    const payload = JSON.parse(io.stdoutText());
    expect(payload.results[0]?.status).toBe("accepted");
    expect(payload.results[0]?.runResult?.run.runId).toBe("run-0001");

    const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
    const run = await runStore.get("run-0001");
    expect(run?.phase).toBe("completed");
    expect(run?.status).toBe("accepted");
  });

  it("starts a fresh run when --fresh is set even if the latest run is recoverable", async () => {
    const repoRoot = join(tempRoot, "repo-fresh");
    await initNumericFixtureRepo(repoRoot);
    await seedProposedRun(repoRoot, {
      runId: "run-0001",
      cycle: 1,
      candidateId: "candidate-0001",
    });
    process.chdir(repoRoot);

    const io = createCapturingIo();
    const exitCode = await runRunCommand({ json: true, fresh: true }, io);

    expect(exitCode).toBe(0);
    const payload = JSON.parse(io.stdoutText());
    expect(payload.results[0]?.runResult?.run.runId).toBe("run-0002");

    const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
    const runs = await runStore.list();
    expect(runs.map((run) => run.runId)).toEqual(["run-0001", "run-0002"]);
    expect(runs[0]?.phase).toBe("proposed");
    expect(runs[1]?.phase).toBe("completed");
  });

  it("warns and starts fresh when the latest run is repair_required, without scanning older runs", async () => {
    const repoRoot = join(tempRoot, "repo-repair-required");
    await initNumericFixtureRepo(repoRoot);
    await seedProposedRun(repoRoot, {
      runId: "run-0001",
      cycle: 1,
      candidateId: "candidate-0001",
    });
    await seedCommittedRun(repoRoot, {
      runId: "run-0002",
      cycle: 2,
      candidateId: "candidate-0002",
    });
    process.chdir(repoRoot);

    const io = createCapturingIo();
    const exitCode = await runRunCommand({}, io);

    expect(exitCode).toBe(0);
    expect(io.stderrText()).toContain("run-0002 requires repair");

    const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
    const runs = await runStore.list();
    expect(runs.map((run) => run.runId)).toEqual(["run-0001", "run-0002", "run-0003"]);
    expect(runs[0]?.phase).toBe("proposed");
    expect(runs[1]?.phase).toBe("committed");
    expect(runs[2]?.phase).toBe("completed");
  });
});

async function seedProposedRun(
  repoRoot: string,
  input: { runId: string; cycle: number; candidateId: string },
): Promise<void> {
  const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
  const workspaceManager = new GitWorktreeWorkspaceManager(repoRoot, join(repoRoot, ".ralph"));
  const workspace = await workspaceManager.createWorkspace(input.candidateId, "main");
  await writeFile(join(workspace.workspacePath, "docs", "draft.md"), "Recovered draft.\n", "utf8");
  const proposeLogPath = join(repoRoot, ".ralph", "runs", input.runId, "logs", `${input.candidateId}.propose.stdout.log`);
  await mkdir(join(repoRoot, ".ralph", "runs", input.runId, "logs"), { recursive: true });
  await writeFile(proposeLogPath, "proposal complete\n", "utf8");

  await runStore.put(
    makeRunRecord({
      runId: input.runId,
      cycle: input.cycle,
      candidateId: input.candidateId,
      phase: "proposed",
      pendingAction: "execute_experiment",
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

async function seedCommittedRun(
  repoRoot: string,
  input: { runId: string; cycle: number; candidateId: string },
): Promise<void> {
  const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));

  await runStore.put(
    makeRunRecord({
      runId: input.runId,
      cycle: input.cycle,
      candidateId: input.candidateId,
      status: "accepted",
      phase: "committed",
      pendingAction: "update_frontier",
      decisionId: `decision-${input.runId}`,
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
