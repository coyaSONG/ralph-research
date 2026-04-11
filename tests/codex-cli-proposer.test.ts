import { describe, expect, it, vi } from "vitest";

import { CodexCliSessionProposer } from "../src/adapters/proposer/codex-cli-proposer.js";

function createConfig() {
  return {
    type: "codex_cli" as const,
    approvalPolicy: "never" as const,
    sandboxMode: "workspace-write" as const,
    ttySession: {
      startupTimeoutSec: 30,
      turnTimeoutSec: 900,
    },
    history: {
      enabled: false,
      maxRuns: 5,
    },
  };
}

describe("CodexCliSessionProposer", () => {
  it("returns truthful invocation and outcome metadata for successful sessions", async () => {
    const proposer = new CodexCliSessionProposer(createConfig(), {
      createSessionId: () => "session-001",
      now: vi.fn()
        .mockReturnValueOnce(new Date("2026-04-12T00:00:00.000Z"))
        .mockReturnValueOnce(new Date("2026-04-12T00:00:01.200Z")),
      createSessionManager: () =>
        ({
          startSession: () =>
            ({
              command: "codex",
              args: ["-C", "/tmp/workspace", "-a", "never", "-s", "workspace-write", "--search"],
              metadata: {
                launchMode: "new",
                researchSessionId: "session-001",
              },
              waitForExit: async () => ({
                code: 0,
                signal: null,
              }),
              stop: async () => ({
                code: null,
                signal: "SIGTERM" as const,
              }),
            }) as never,
        }) as never,
    });

    await expect(
      proposer.run({
        workspacePath: "/tmp/workspace",
      }),
    ).resolves.toMatchObject({
      proposerType: "codex_cli",
      summary: "codex_cli session session-001 completed with exit code 0 in 1200ms",
      adapterMetadata: {
        adapter: "codex_cli",
        invocation: {
          sessionId: "session-001",
          command: "codex",
          args: ["-C", "/tmp/workspace", "-a", "never", "-s", "workspace-write", "--search"],
          cwd: "/tmp/workspace",
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
      },
    });
  });

  it("reuses a persisted Codex session id when the cycle context requests resume", async () => {
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
        researchSessionId: "research-session-123",
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
    const proposer = new CodexCliSessionProposer(createConfig(), {
      createSessionManager: () =>
        ({
          startSession,
        }) as never,
      now: vi.fn()
        .mockReturnValueOnce(new Date("2026-04-12T00:00:00.000Z"))
        .mockReturnValueOnce(new Date("2026-04-12T00:00:01.200Z")),
    });

    await expect(
      proposer.run({
        workspacePath: "/tmp/workspace",
        codexSession: {
          researchSessionId: "research-session-123",
          existingCodexSessionId: "codex-session-777",
        },
      }),
    ).resolves.toMatchObject({
      summary: "codex_cli session codex-session-777 completed with exit code 0 in 1200ms",
      adapterMetadata: {
        adapter: "codex_cli",
        invocation: {
          sessionId: "research-session-123",
          sessionMetadata: {
            launchMode: "resume",
            researchSessionId: "research-session-123",
            codexSessionId: "codex-session-777",
          },
        },
        outcome: {
          summary: "codex_cli session codex-session-777 completed with exit code 0 in 1200ms",
        },
      },
    });
    expect(startSession).toHaveBeenCalledWith({
      cwd: "/tmp/workspace",
      sessionId: "research-session-123",
      existingSessionId: "codex-session-777",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
    });
  });

  it("prefers the launched handle metadata as the authoritative Codex session id in summaries", async () => {
    const proposer = new CodexCliSessionProposer(createConfig(), {
      createSessionManager: () =>
        ({
          startSession: () =>
            ({
              command: "codex",
              args: [
                "resume",
                "codex-session-live",
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
                researchSessionId: "research-session-123",
                codexSessionId: "codex-session-live",
              },
              waitForExit: async () => ({
                code: 0,
                signal: null,
              }),
              stop: async () => ({
                code: null,
                signal: "SIGTERM" as const,
              }),
            }) as never,
        }) as never,
      now: vi.fn()
        .mockReturnValueOnce(new Date("2026-04-12T00:00:00.000Z"))
        .mockReturnValueOnce(new Date("2026-04-12T00:00:01.200Z")),
    });

    await expect(
      proposer.run({
        workspacePath: "/tmp/workspace",
        codexSession: {
          researchSessionId: "research-session-123",
          existingCodexSessionId: "codex-session-stale",
        },
      }),
    ).resolves.toMatchObject({
      summary: "codex_cli session codex-session-live completed with exit code 0 in 1200ms",
      adapterMetadata: {
        outcome: {
          summary: "codex_cli session codex-session-live completed with exit code 0 in 1200ms",
        },
      },
    });
  });

  it("surfaces startup failures with the underlying adapter message", async () => {
    const proposer = new CodexCliSessionProposer(createConfig(), {
      createSessionManager: () =>
        ({
          startSession: () => {
            throw new Error("Codex CLI requires an interactive terminal on stdin and stdout");
          },
        }) as never,
    });

    await expect(
      proposer.run({
        workspacePath: "/tmp/workspace",
      }),
    ).rejects.toThrow(
      "codex_cli proposer failed to start: Codex CLI requires an interactive terminal on stdin and stdout",
    );
  });

  it("reports non-zero exits truthfully instead of masking them behind a placeholder error", async () => {
    const stop = vi.fn(async () => ({
      code: null,
      signal: "SIGTERM" as const,
    }));
    const proposer = new CodexCliSessionProposer(createConfig(), {
      createSessionManager: () =>
        ({
          startSession: () =>
            ({
              waitForExit: async () => ({
                code: 17,
                signal: null,
              }),
              stop,
            }) as never,
        }) as never,
    });

    await expect(
      proposer.run({
        workspacePath: "/tmp/workspace",
      }),
    ).rejects.toThrow("codex_cli proposer exited with code 17");
    expect(stop).not.toHaveBeenCalled();
  });

  it("reports waitForExit adapter failures truthfully", async () => {
    const proposer = new CodexCliSessionProposer(createConfig(), {
      createSessionManager: () =>
        ({
          startSession: () =>
            ({
              waitForExit: async () => {
                throw new Error("spawn codex ENOENT");
              },
              stop: async () => ({
                code: null,
                signal: "SIGTERM" as const,
              }),
            }) as never,
        }) as never,
    });

    await expect(
      proposer.run({
        workspacePath: "/tmp/workspace",
      }),
    ).rejects.toThrow("codex_cli proposer session failed: spawn codex ENOENT");
  });
});
