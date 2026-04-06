import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonFileRunStore } from "../src/adapters/fs/json-file-run-store.js";
import { GitWorktreeWorkspaceManager } from "../src/core/engine/workspace-manager.js";
import type { RunRecord } from "../src/core/model/run-record.js";
import { createRalphResearchMcpServer } from "../src/mcp/server.js";
import { initNumericFixtureRepo } from "./helpers/fixture-repo.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-mcp-server-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("MCP server recovery parity", () => {
  it("exposes the shared recovery classification from get_research_status", async () => {
    const repoRoot = join(tempRoot, "repo-status");
    await initNumericFixtureRepo(repoRoot);
    await seedCommittedRun(repoRoot);

    const server = createRalphResearchMcpServer({ repoRoot });
    const tool = (server as any)._registeredTools.get_research_status;
    const result = await (server as any).executeToolHandler(tool, { repoRoot }, {});
    const payload = JSON.parse(result.content[0].text);

    expect(payload.recovery).toMatchObject({
      classification: "repair_required",
      nextAction: "none",
      resumeAllowed: false,
    });
    expect(payload.runtime).toMatchObject({
      state: "stopped",
      reason: "repair required",
    });
  });

  it("auto-resumes the latest recoverable run through run_research_cycle", async () => {
    const repoRoot = join(tempRoot, "repo-run");
    await initNumericFixtureRepo(repoRoot);
    await seedProposedRun(repoRoot);

    const server = createRalphResearchMcpServer({ repoRoot });
    const tool = (server as any)._registeredTools.run_research_cycle;
    const result = await (server as any).executeToolHandler(tool, { repoRoot, cycles: 1 }, {});
    const payload = JSON.parse(result.content[0].text);

    expect(payload.ok).toBe(true);
    expect(payload.results[0]?.runResult?.run.runId).toBe("run-0001");
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
