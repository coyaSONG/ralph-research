import { describe, expect, it, vi } from "vitest";

import { CodexCliSessionProposer } from "../src/adapters/proposer/codex-cli-proposer.js";
import { createProposerRunner } from "../src/adapters/proposer/proposer-factory.js";

describe("createProposerRunner", () => {
  it("delegates command proposers through the existing command runner path", async () => {
    const runCommand = vi.fn(async () => ({
      proposerType: "command" as const,
      command: "node ./scripts/propose.mjs",
      cwd: "/tmp/workspace",
      stdout: "proposal complete",
      stderr: "",
      summary: "generated candidate with command proposer in 1ms",
      durationMs: 1,
    }));

    const proposer = createProposerRunner(
      {
        type: "command",
        command: "node ./scripts/propose.mjs",
        env: {},
        timeoutSec: 30,
        history: {
          enabled: false,
          maxRuns: 5,
        },
      },
      { runCommand },
    );
    const result = await proposer.run({
      workspacePath: "/tmp/workspace",
      env: {
        RRX_HISTORY_ENABLED: "1",
      },
    });

    expect(runCommand).toHaveBeenCalledWith(
      {
        type: "command",
        command: "node ./scripts/propose.mjs",
        env: {},
        timeoutSec: 30,
        history: {
          enabled: false,
          maxRuns: 5,
        },
      },
      {
        workspacePath: "/tmp/workspace",
        env: {
          RRX_HISTORY_ENABLED: "1",
        },
      },
    );
    expect(result).toMatchObject({
      proposerType: "command",
      stdout: "proposal complete",
    });
  });

  it("instantiates the codex_cli proposer runner from manifest config", async () => {
    const startSession = vi.fn(() => ({
      waitForExit: async () => ({
        code: 0,
        signal: null,
      }),
      stop: async () => ({
        code: null,
        signal: "SIGTERM" as const,
      }),
    }));
    const createSessionManager = vi.fn(
      () =>
        ({
          startSession,
        }) as never,
    );

    const proposer = createProposerRunner(
      {
        type: "codex_cli",
        approvalPolicy: "never",
        sandboxMode: "workspace-write",
        ttySession: {
          startupTimeoutSec: 30,
          turnTimeoutSec: 900,
        },
        history: {
          enabled: false,
          maxRuns: 5,
        },
      },
      {
        createSessionManager,
        createSessionId: () => "session-001",
        now: () => new Date("2026-04-12T00:00:00.000Z"),
      },
    );

    expect(proposer).toBeInstanceOf(CodexCliSessionProposer);
    expect(createSessionManager).toHaveBeenCalledTimes(1);
    await expect(
      proposer.run({
        workspacePath: "/tmp/workspace",
        env: {
          RRX_HISTORY_ENABLED: "1",
        },
      }),
    ).resolves.toMatchObject({
      proposerType: "codex_cli",
      summary: "codex_cli session session-001 completed with exit code 0 in 0ms",
    });
    expect(startSession).toHaveBeenCalledWith({
      cwd: "/tmp/workspace",
      sessionId: "session-001",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      env: {
        RRX_HISTORY_ENABLED: "1",
      },
    });
  });

  it("passes persisted Codex session context through the codex_cli proposer runner", async () => {
    const startSession = vi.fn(() => ({
      command: "codex",
      args: [
        "resume",
        "codex-session-777",
        "-C",
        "/tmp/workspace",
        "-a",
        "never",
        "-s",
        "workspace-write",
        "--search",
      ],
      metadata: {
        launchMode: "resume" as const,
        researchSessionId: "research-session-001",
        codexSessionId: "codex-session-777",
      },
      waitForExit: async () => ({
        code: 0,
        signal: null,
      }),
      stop: async () => ({
        code: null,
        signal: "SIGTERM" as const,
      }),
    }));
    const createSessionManager = vi.fn(
      () =>
        ({
          startSession,
        }) as never,
    );

    const proposer = createProposerRunner(
      {
        type: "codex_cli",
        approvalPolicy: "never",
        sandboxMode: "workspace-write",
        ttySession: {
          startupTimeoutSec: 30,
          turnTimeoutSec: 900,
        },
        history: {
          enabled: false,
          maxRuns: 5,
        },
      },
      {
        createSessionManager,
        now: () => new Date("2026-04-12T00:00:00.000Z"),
      },
    );

    await expect(
      proposer.run({
        workspacePath: "/tmp/workspace",
        codexSession: {
          researchSessionId: "research-session-001",
          existingCodexSessionId: "codex-session-777",
        },
      }),
    ).resolves.toMatchObject({
      proposerType: "codex_cli",
      summary: "codex_cli session codex-session-777 completed with exit code 0 in 0ms",
    });
    expect(startSession).toHaveBeenCalledWith({
      cwd: "/tmp/workspace",
      sessionId: "research-session-001",
      existingSessionId: "codex-session-777",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
    });
  });
});
