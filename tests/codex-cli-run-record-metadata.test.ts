import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";

import { JsonFileDecisionStore } from "../src/adapters/fs/json-file-decision-store.js";
import { JsonFileFrontierStore } from "../src/adapters/fs/json-file-frontier-store.js";
import { JsonFileRunStore } from "../src/adapters/fs/json-file-run-store.js";
import { GitClient } from "../src/adapters/git/git-client.js";
import {
  buildCodexCliArgs,
  type CodexCliSessionLaunchOptions,
} from "../src/adapters/proposer/codex-cli-session-manager.js";
import { createProposerRunner } from "../src/adapters/proposer/proposer-factory.js";
import { runCycle } from "../src/core/engine/cycle-runner.js";
import { GitWorktreeWorkspaceManager } from "../src/core/engine/workspace-manager.js";
import { RalphManifestSchema } from "../src/core/manifest/schema.js";
import { initNumericFixtureRepo } from "./helpers/fixture-repo.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-codex-cli-run-record-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("codex_cli run record metadata", () => {
  it("drives a codex_cli session through the cycle runner and persists the resulting run state", async () => {
    const repoRoot = join(tempRoot, "repo");
    await initNumericFixtureRepo(repoRoot);
    const manifest = RalphManifestSchema.parse(buildCodexCliManifest());
    const { stdout: baselineRef } = await execa("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
    const storageRoot = join(repoRoot, manifest.storage.root);
    const runStore = new JsonFileRunStore(join(storageRoot, "runs"));
    const frontierStore = new JsonFileFrontierStore(join(storageRoot, "frontier.json"));
    const decisionStore = new JsonFileDecisionStore(join(storageRoot, "decisions"));
    const sessionManager = new FakeCodexCliSessionManager();

    const result = await runCycle(
      {
        repoRoot,
        manifestPath: join(repoRoot, "ralph.yaml"),
        manifest,
        resolvedBaselineRef: baselineRef.trim(),
        currentFrontier: [],
      },
      {
        runStore,
        frontierStore,
        decisionStore,
        workspaceManager: new GitWorktreeWorkspaceManager(repoRoot, storageRoot),
        gitClient: new GitClient(repoRoot),
        createProposerRunner: (proposer) =>
          createProposerRunner(proposer, {
            createSessionManager: () => sessionManager as never,
            createSessionId: () => "session-001",
            now: createSessionClock(),
          }),
      },
    );

    const stored = await runStore.get(result.run.runId);
    const storedDecision = await decisionStore.get("decision-run-0001");
    const storedFrontier = await frontierStore.load();

    expect(sessionManager.launches).toHaveLength(1);
    expect(sessionManager.launches[0]).toMatchObject({
      sessionId: "session-001",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      cwd: expect.stringContaining(".ralph/workspaces/candidate-0001"),
    });
    expect(stored?.proposal.proposerType).toBe("codex_cli");
    expect(stored?.proposal.adapterMetadata).toEqual({
      adapter: "codex_cli",
      invocation: {
        sessionId: "session-001",
        command: "codex",
        args: [
          "-C",
          expect.stringContaining(".ralph/workspaces/candidate-0001"),
          "-a",
          "never",
          "-s",
          "workspace-write",
          "--search",
        ],
        cwd: expect.stringContaining(".ralph/workspaces/"),
        sessionMetadata: {
          launchMode: "new",
          researchSessionId: "session-001",
        },
      },
      outcome: {
        kind: "terminal_exit",
        code: 0,
        signal: null,
        durationMs: 1200,
        summary: "codex_cli session session-001 completed with exit code 0 in 1200ms",
      },
    });
    expect(stored?.status).toBe("accepted");
    expect(stored?.phase).toBe("completed");
    expect(stored?.metrics.quality?.value).toBeCloseTo(0.7);
    expect(stored?.logs.proposeStdoutPath).toBeTruthy();
    expect(stored?.logs.runStdoutPath).toBeTruthy();
    expect(await readFile(stored?.logs.proposeStdoutPath ?? "", "utf8")).toBe("");
    expect(await readFile(stored?.logs.runStdoutPath ?? "", "utf8")).toContain("experiment complete");
    expect(storedDecision?.outcome).toBe("accepted");
    expect(storedDecision?.commitSha).toBeTruthy();
    expect(storedFrontier[0]?.runId).toBe("run-0001");
    expect(storedFrontier[0]?.commitSha).toBe(storedDecision?.commitSha);

    const acceptedDraft = await readFile(join(repoRoot, "docs", "draft.md"), "utf8");
    expect(acceptedDraft).toBe("Improved draft with stronger structure.\n");
  });

  it("records resumed Codex session metadata when a cycle continues from a persisted session reference", async () => {
    const repoRoot = join(tempRoot, "repo");
    await initNumericFixtureRepo(repoRoot);
    const manifest = RalphManifestSchema.parse(buildCodexCliManifest());
    const { stdout: baselineRef } = await execa("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
    const storageRoot = join(repoRoot, manifest.storage.root);
    const runStore = new JsonFileRunStore(join(storageRoot, "runs"));
    const frontierStore = new JsonFileFrontierStore(join(storageRoot, "frontier.json"));
    const decisionStore = new JsonFileDecisionStore(join(storageRoot, "decisions"));
    const sessionManager = new FakeCodexCliSessionManager();

    const result = await runCycle(
      {
        repoRoot,
        manifestPath: join(repoRoot, "ralph.yaml"),
        manifest,
        resolvedBaselineRef: baselineRef.trim(),
        currentFrontier: [],
        codexSession: {
          researchSessionId: "research-session-123",
          existingCodexSessionId: "codex-session-777",
        },
      },
      {
        runStore,
        frontierStore,
        decisionStore,
        workspaceManager: new GitWorktreeWorkspaceManager(repoRoot, storageRoot),
        gitClient: new GitClient(repoRoot),
        createProposerRunner: (proposer) =>
          createProposerRunner(proposer, {
            createSessionManager: () => sessionManager as never,
            now: createSessionClock(),
          }),
      },
    );

    const stored = await runStore.get(result.run.runId);

    expect(sessionManager.launches).toHaveLength(1);
    expect(sessionManager.launches[0]).toMatchObject({
      sessionId: "research-session-123",
      existingSessionId: "codex-session-777",
    });
    expect(stored?.proposal.adapterMetadata).toEqual({
      adapter: "codex_cli",
      invocation: {
        sessionId: "research-session-123",
        command: "codex",
        args: [
          "resume",
          "codex-session-777",
          "-C",
          expect.stringContaining(".ralph/workspaces/candidate-0001"),
          "-a",
          "never",
          "-s",
          "workspace-write",
          "--search",
        ],
        cwd: expect.stringContaining(".ralph/workspaces/"),
        sessionMetadata: {
          launchMode: "resume",
          researchSessionId: "research-session-123",
          codexSessionId: "codex-session-777",
        },
      },
      outcome: {
        kind: "terminal_exit",
        code: 0,
        signal: null,
        durationMs: 1200,
        summary: "codex_cli session codex-session-777 completed with exit code 0 in 1200ms",
      },
    });
  });
});

class FakeCodexCliSessionManager {
  public readonly launches: CodexCliSessionLaunchOptions[] = [];

  public startSession(options: CodexCliSessionLaunchOptions) {
    this.launches.push({
      ...options,
      ...(options.env ? { env: { ...options.env } } : {}),
    });

    const existingSessionId = options.existingSessionId;

    return {
      command: options.command ?? "codex",
      args: buildCodexCliArgs(options),
      metadata: {
        launchMode: existingSessionId ? ("resume" as const) : ("new" as const),
        researchSessionId: options.sessionId,
        ...(existingSessionId ? { codexSessionId: existingSessionId } : {}),
      },
      waitForExit: async () => {
        await writeFile(join(options.cwd, "docs", "draft.md"), "Improved draft with stronger structure.\n", "utf8");
        return {
          code: 0,
          signal: null,
        };
      },
      stop: async () => ({
        code: null,
        signal: "SIGTERM" as const,
      }),
    };
  }
}

function createSessionClock(): () => Date {
  let tick = 0;
  return () => {
    const timestamp = tick === 0
      ? "2026-04-12T00:00:00.000Z"
      : "2026-04-12T00:00:01.200Z";
    tick += 1;
    return new Date(timestamp);
  };
}

function buildCodexCliManifest() {
  return {
    schemaVersion: "0.1",
    project: {
      name: "test-codex-cli",
      artifact: "manuscript",
      baselineRef: "main",
      workspace: "git",
    },
    scope: {
      allowedGlobs: ["**/*.md"],
      maxFilesChanged: 2,
      maxLineDelta: 20,
    },
    proposer: {
      type: "codex_cli",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      ttySession: {},
    },
    experiment: {
      run: {
        command: "node scripts/experiment.mjs",
      },
      outputs: [
        {
          id: "draft",
          path: "out/draft.md",
        },
      ],
    },
    metrics: {
      catalog: [
        {
          id: "quality",
          kind: "numeric",
          direction: "maximize",
          extractor: {
            type: "command",
            command: "node scripts/metric.mjs",
            parser: "plain_number",
          },
        },
      ],
    },
    constraints: [],
    frontier: {
      strategy: "single_best",
      primaryMetric: "quality",
    },
    ratchet: {
      type: "epsilon_improve",
      metric: "quality",
      epsilon: 0,
    },
    storage: {
      root: ".ralph",
    },
  };
}
