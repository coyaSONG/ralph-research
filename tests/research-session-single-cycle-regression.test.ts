import { access, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonFileDecisionStore } from "../src/adapters/fs/json-file-decision-store.js";
import { JsonFileFrontierStore } from "../src/adapters/fs/json-file-frontier-store.js";
import { JsonFileRunStore } from "../src/adapters/fs/json-file-run-store.js";
import { ResearchSessionLaunchService } from "../src/app/services/research-session-launch-service.js";
import { ResearchSessionOrchestratorService } from "../src/app/services/research-session-orchestrator-service.js";
import { JsonFileResearchSessionRepository } from "../src/adapters/fs/json-file-research-session-repository.js";
import { runFrontierCommand } from "../src/cli/commands/frontier.js";
import { createRalphResearchMcpServer } from "../src/mcp/server.js";
import { initIncrementingMetricFixtureRepo, initNumericFixtureRepo } from "./helpers/fixture-repo.js";

let tempRoot = "";
let originalCwd = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-session-single-cycle-"));
  originalCwd = process.cwd();
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("Research session single-cycle regression coverage", () => {
  it("preserves accepted run and decision persistence when a started session executes one real cycle", async () => {
    const repoRoot = join(tempRoot, "repo");
    await initNumericFixtureRepo(repoRoot);

    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await launchService.launch({
      goal: "Improve the horse-racing holdout report.",
      repoRoot,
    });
    const service = new ResearchSessionOrchestratorService({
      now: createClock([
        "2026-04-12T00:01:00.000Z",
        "2026-04-12T00:02:00.000Z",
      ]),
      createSessionId: () => "session-started",
    });

    const started = await service.startSession({
      repoRoot,
      draftSessionId: launch.sessionId,
    });
    const stepped = await service.step({
      repoRoot,
      sessionId: started.session.sessionId,
    });

    const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
    const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".ralph", "decisions"));
    const frontierStore = new JsonFileFrontierStore(join(repoRoot, ".ralph", "frontier.json"));
    const sessionRepository = new JsonFileResearchSessionRepository(join(repoRoot, ".ralph", "sessions"));
    const run = await runStore.get("run-0001");
    const decision = await decisionStore.get("decision-run-0001");
    const frontier = await frontierStore.load();
    const session = await sessionRepository.loadSession("session-started");
    const manifestPath = await realpath(join(repoRoot, "ralph.yaml"));
    const cliFrontier = await readCliFrontier(repoRoot);
    const mcpFrontier = await readMcpFrontier(repoRoot);

    expect(stepped).toMatchObject({
      step: "cycle_checkpointed",
      cycle: {
        run: {
          runId: "run-0001",
          cycle: 1,
          status: "accepted",
          phase: "completed",
        },
        decision: {
          decisionId: "decision-run-0001",
          runId: "run-0001",
          outcome: "accepted",
        },
        latestFrontierIds: [frontier[0]?.frontierId],
      },
    });
    expect(run?.status).toBe("accepted");
    expect(run?.phase).toBe("completed");
    expect(run?.proposal.patchPath).toBeTruthy();
    await expect(pathExists(run?.proposal.patchPath ?? "")).resolves.toBe(true);
    expect(decision?.outcome).toBe("accepted");
    expect(decision?.commitSha).toBeTruthy();
    expect(frontier).toHaveLength(1);
    expect(frontier[0]?.runId).toBe("run-0001");
    expect(frontier[0]?.metrics.quality.value).toBeCloseTo(0.7);
    expect(frontier[0]?.commitSha).toBe(decision?.commitSha);
    expect(cliFrontier).toEqual({
      manifestPath,
      frontier,
    });
    expect(mcpFrontier).toEqual({
      manifestPath: join(repoRoot, "ralph.yaml"),
      frontier,
    });
    expect(session).toMatchObject({
      sessionId: "session-started",
      status: "running",
      progress: {
        completedCycles: 1,
        nextCycle: 2,
        latestRunId: "run-0001",
        latestDecisionId: "decision-run-0001",
        latestFrontierIds: [frontier[0]?.frontierId],
      },
      resume: {
        resumeFromCycle: 2,
        checkpointRunId: "run-0001",
        checkpointDecisionId: "decision-run-0001",
      },
    });
    expect(await readFile(join(repoRoot, "docs", "draft.md"), "utf8")).toBe("Improved draft with stronger structure.\n");
  });

  it("preserves real single-cycle run and decision persistence after interrupt and resume", async () => {
    const repoRoot = join(tempRoot, "repo");
    await initIncrementingMetricFixtureRepo(repoRoot);

    const launchService = new ResearchSessionLaunchService({
      now: () => new Date("2026-04-12T00:00:00.000Z"),
    });
    const launch = await launchService.launch({
      goal: "Reach 70% future holdout top-3 prediction success.",
      repoRoot,
    });
    const service = new ResearchSessionOrchestratorService({
      now: createClock([
        "2026-04-12T00:01:00.000Z",
        "2026-04-12T00:02:00.000Z",
        "2026-04-12T00:03:00.000Z",
        "2026-04-12T00:04:00.000Z",
        "2026-04-12T00:05:00.000Z",
      ]),
      createSessionId: () => "session-resumed",
      recoveryService: {
        classifySession: async () => ({
          classification: "resumable",
          resumeAllowed: true,
          reason: "Resume from the last completed cycle boundary",
          runtime: {
            state: "stale",
            processAlive: false,
            stale: true,
            phase: "running",
          },
        }),
      },
    });

    const started = await service.startSession({
      repoRoot,
      draftSessionId: launch.sessionId,
    });
    const firstStep = await service.step({
      repoRoot,
      sessionId: started.session.sessionId,
    });
    const interrupted = await service.recordInterruption({
      repoRoot,
      sessionId: started.session.sessionId,
      note: "TTY disconnected",
    });
    const resumed = await service.resumeSession({
      repoRoot,
      sessionId: started.session.sessionId,
    });
    const secondStep = await service.step({
      repoRoot,
      sessionId: started.session.sessionId,
    });

    const runStore = new JsonFileRunStore(join(repoRoot, ".ralph", "runs"));
    const decisionStore = new JsonFileDecisionStore(join(repoRoot, ".ralph", "decisions"));
    const frontierStore = new JsonFileFrontierStore(join(repoRoot, ".ralph", "frontier.json"));
    const sessionRepository = new JsonFileResearchSessionRepository(join(repoRoot, ".ralph", "sessions"));
    const run = await runStore.get("run-0002");
    const decision = await decisionStore.get("decision-run-0002");
    const frontier = await frontierStore.load();
    const session = await sessionRepository.loadSession("session-resumed");
    const manifestPath = await realpath(join(repoRoot, "ralph.yaml"));
    const cliFrontier = await readCliFrontier(repoRoot);
    const mcpFrontier = await readMcpFrontier(repoRoot);

    expect(firstStep.cycle.run?.runId).toBe("run-0001");
    expect(interrupted).toMatchObject({
      step: "session_interrupted",
      session: {
        status: "awaiting_resume",
        resume: {
          resumeFromCycle: 2,
          checkpointRunId: "run-0001",
          checkpointDecisionId: "decision-run-0001",
          requiresUserConfirmation: true,
        },
      },
    });
    expect(resumed).toMatchObject({
      step: "session_resumed",
      session: {
        status: "running",
        progress: {
          completedCycles: 1,
          nextCycle: 2,
          latestRunId: "run-0001",
          latestDecisionId: "decision-run-0001",
        },
        resume: {
          resumeFromCycle: 2,
          checkpointRunId: "run-0001",
          checkpointDecisionId: "decision-run-0001",
          requiresUserConfirmation: false,
        },
      },
    });
    expect(secondStep).toMatchObject({
      step: "cycle_checkpointed",
      cycle: {
        run: {
          runId: "run-0002",
          cycle: 2,
          status: "accepted",
          phase: "completed",
        },
        decision: {
          decisionId: "decision-run-0002",
          runId: "run-0002",
          outcome: "accepted",
        },
        latestFrontierIds: [frontier[0]?.frontierId],
      },
    });
    expect(run?.status).toBe("accepted");
    expect(run?.phase).toBe("completed");
    expect(run?.proposal.patchPath).toBeTruthy();
    await expect(pathExists(run?.proposal.patchPath ?? "")).resolves.toBe(true);
    expect(run?.metrics.quality?.value).toBeCloseTo(0.8);
    expect(decision?.outcome).toBe("accepted");
    expect(decision?.commitSha).toBeTruthy();
    expect(frontier).toHaveLength(1);
    expect(frontier[0]?.runId).toBe("run-0002");
    expect(frontier[0]?.metrics.quality.value).toBeCloseTo(0.8);
    expect(frontier[0]?.commitSha).toBe(decision?.commitSha);
    expect(cliFrontier).toEqual({
      manifestPath,
      frontier,
    });
    expect(mcpFrontier).toEqual({
      manifestPath: join(repoRoot, "ralph.yaml"),
      frontier,
    });
    expect(session).toMatchObject({
      sessionId: "session-resumed",
      status: "running",
      progress: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-0002",
        latestDecisionId: "decision-run-0002",
        latestFrontierIds: [frontier[0]?.frontierId],
      },
      resume: {
        resumeFromCycle: 3,
        checkpointRunId: "run-0002",
        checkpointDecisionId: "decision-run-0002",
      },
    });
    expect(await readFile(join(repoRoot, "docs", "draft.md"), "utf8")).toBe(
      "Baseline draft.\nImproved draft line.\nImproved draft line.\n",
    );
  });
});

function createClock(timestamps: string[]): () => Date {
  let index = 0;

  return () => {
    const timestamp = timestamps[Math.min(index, timestamps.length - 1)];
    index += 1;
    return new Date(timestamp);
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readCliFrontier(repoRoot: string): Promise<Record<string, unknown>> {
  process.chdir(repoRoot);
  const io = createCapturingIo();
  expect(await runFrontierCommand({ json: true }, io)).toBe(0);
  return JSON.parse(io.stdoutText()) as Record<string, unknown>;
}

async function readMcpFrontier(repoRoot: string): Promise<Record<string, unknown>> {
  const server = createRalphResearchMcpServer({ repoRoot });
  const tool = (server as any)._registeredTools.get_frontier;
  const result = await (server as any).executeToolHandler(tool, { repoRoot }, {});
  return parseJsonToolResponse(result);
}

function createCapturingIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout: (message: string) => {
      stdout.push(message);
    },
    stderr: (message: string) => {
      stderr.push(message);
    },
    stdoutText: () => stdout.join("\n"),
    stderrText: () => stderr.join("\n"),
  };
}

function parseJsonToolResponse(result: unknown): Record<string, unknown> {
  expect(result).toMatchObject({
    content: [
      {
        type: "text",
      },
    ],
  });

  const response = result as {
    content: Array<{
      type: "text";
      text: string;
    }>;
  };

  expect(response.content).toHaveLength(1);
  expect(typeof response.content[0]?.text).toBe("string");

  return JSON.parse(response.content[0]!.text) as Record<string, unknown>;
}
