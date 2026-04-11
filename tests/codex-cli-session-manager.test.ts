import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import {
  buildCodexCliArgs,
  buildCodexCliEnvironment,
  CodexCliSessionManager,
  getCodexCliSessionTtyMetadata,
  isInteractiveTerminal,
} from "../src/adapters/proposer/codex-cli-session-manager.js";

class FakeRuntimeProcess extends EventEmitter {
  public readonly env: NodeJS.ProcessEnv = {
    HOME: "/home/tester",
    PATH: "/usr/bin",
    TERM: "xterm-256color",
  };

  public readonly stdin = { isTTY: true } as NodeJS.ReadableStream;
  public readonly stdout = { isTTY: true, columns: 120, rows: 40 } as NodeJS.WritableStream;
}

class FakeChildProcess extends EventEmitter {
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;
  public killed = false;
  public readonly pid = 42;
  public readonly killCalls: Array<NodeJS.Signals | number | undefined> = [];

  public kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.killCalls.push(signal);
    return true;
  }

  public finish(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  public fail(error: Error): void {
    this.emit("error", error);
  }
}

describe("CodexCliSessionManager", () => {
  it("launches Codex with the interactive CLI flags and session environment", () => {
    const runtime = new FakeRuntimeProcess();
    const child = new FakeChildProcess();
    let observedCommand = "";
    let observedArgs: string[] = [];
    let observedOptions: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: unknown } = {};

    const manager = new CodexCliSessionManager({
      runtimeProcess: runtime,
      spawn: (command, args, options) => {
        observedCommand = command;
        observedArgs = args;
        observedOptions = options;
        return child as never;
      },
    });

    const handle = manager.startSession({
      cwd: "/workspace/repo",
      sessionId: "session-001",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      model: "gpt-5.4",
      prompt: "continue from the last completed cycle",
      extraWritableDirectories: ["/workspace/repo/.ralph"],
      env: {
        CUSTOM_FLAG: "1",
      },
    });

    expect(handle.command).toBe("codex");
    expect(observedCommand).toBe("codex");
    expect(observedArgs).toEqual([
      "-C",
      "/workspace/repo",
      "-a",
      "never",
      "-s",
      "workspace-write",
      "-m",
      "gpt-5.4",
      "--search",
      "--add-dir",
      "/workspace/repo/.ralph",
      "continue from the last completed cycle",
    ]);
    expect(observedOptions.cwd).toBe("/workspace/repo");
    expect(observedOptions.stdio).toBe("inherit");
    expect(observedOptions.env).toMatchObject({
      CUSTOM_FLAG: "1",
      HOME: "/home/tester",
      INIT_CWD: "/workspace/repo",
      PATH: "/usr/bin",
      PWD: "/workspace/repo",
      RRX_AGENT: "codex_cli",
      RRX_SESSION_ID: "session-001",
    });
    expect(handle.tty).toEqual({
      stdinIsTty: true,
      stdoutIsTty: true,
      columns: 120,
      rows: 40,
      term: "xterm-256color",
    });
    expect(handle.metadata).toEqual({
      launchMode: "new",
      researchSessionId: "session-001",
    });
  });

  it("uses the resume subcommand and exposes reusable session metadata for follow-up turns", () => {
    const runtime = new FakeRuntimeProcess();
    const child = new FakeChildProcess();
    let observedArgs: string[] = [];

    const manager = new CodexCliSessionManager({
      runtimeProcess: runtime,
      spawn: (_command, args) => {
        observedArgs = args;
        return child as never;
      },
    });

    const handle = manager.startSession({
      cwd: "/workspace/repo",
      sessionId: "research-session-001",
      existingSessionId: "codex-session-777",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      prompt: "Continue from the last completed cycle.",
    });

    expect(observedArgs).toEqual([
      "resume",
      "codex-session-777",
      "-C",
      "/workspace/repo",
      "-a",
      "never",
      "-s",
      "workspace-write",
      "--search",
      "Continue from the last completed cycle.",
    ]);
    expect(handle.metadata).toEqual({
      launchMode: "resume",
      researchSessionId: "research-session-001",
      codexSessionId: "codex-session-777",
    });
  });

  it("reuses the provided Codex session id for consecutive cycle turns", async () => {
    const runtime = new FakeRuntimeProcess();
    const spawnedArgs: string[][] = [];
    const children: FakeChildProcess[] = [];

    const manager = new CodexCliSessionManager({
      runtimeProcess: runtime,
      spawn: (_command, args) => {
        spawnedArgs.push(args);
        const child = new FakeChildProcess();
        children.push(child);
        return child as never;
      },
    });

    const firstHandle = manager.startSession({
      cwd: "/workspace/repo",
      sessionId: "research-session-001",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      prompt: "Cycle 1 prompt",
    });

    children[0]?.finish(0, null);
    await expect(firstHandle.waitForExit()).resolves.toEqual({
      code: 0,
      signal: null,
    });

    const secondHandle = manager.startSession({
      cwd: "/workspace/repo",
      sessionId: "research-session-001",
      existingSessionId: "codex-session-777",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      prompt: "Cycle 2 prompt",
    });

    children[1]?.finish(0, null);
    await expect(secondHandle.waitForExit()).resolves.toEqual({
      code: 0,
      signal: null,
    });

    expect(spawnedArgs).toEqual([
      [
        "-C",
        "/workspace/repo",
        "-a",
        "never",
        "-s",
        "workspace-write",
        "--search",
        "Cycle 1 prompt",
      ],
      [
        "resume",
        "codex-session-777",
        "-C",
        "/workspace/repo",
        "-a",
        "never",
        "-s",
        "workspace-write",
        "--search",
        "Cycle 2 prompt",
      ],
    ]);
    expect(firstHandle.metadata).toEqual({
      launchMode: "new",
      researchSessionId: "research-session-001",
    });
    expect(secondHandle.metadata).toEqual({
      launchMode: "resume",
      researchSessionId: "research-session-001",
      codexSessionId: "codex-session-777",
    });
  });

  it("can reattach a live session by the persisted Codex session id alias", () => {
    const runtime = new FakeRuntimeProcess();
    const child = new FakeChildProcess();

    const manager = new CodexCliSessionManager({
      runtimeProcess: runtime,
      spawn: () => child as never,
    });

    const handle = manager.startSession({
      cwd: "/workspace/repo",
      sessionId: "research-session-001",
      existingSessionId: "codex-session-777",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      prompt: "Cycle 2 prompt",
    });

    const reattached = new CodexCliSessionManager({
      runtimeProcess: runtime,
      spawn: () => {
        throw new Error("spawn should not be called during reattach");
      },
    }).reattachSession({
      sessionId: "research-session-001",
      codexSessionId: "codex-session-777",
    });

    expect(reattached).toBe(handle);
  });

  it("rejects session launch when stdin/stdout are not interactive terminals", () => {
    const runtime = new FakeRuntimeProcess();
    runtime.stdin.isTTY = false;

    const manager = new CodexCliSessionManager({
      runtimeProcess: runtime,
      spawn: () => {
        throw new Error("spawn should not be called");
      },
    });

    expect(() =>
      manager.startSession({
        cwd: "/workspace/repo",
        sessionId: "session-001",
        approvalPolicy: "never",
        sandboxMode: "workspace-write",
      }),
    ).toThrow("Codex CLI requires an interactive terminal");
  });

  it("rejects blank existing session identifiers", () => {
    const runtime = new FakeRuntimeProcess();
    const manager = new CodexCliSessionManager({
      runtimeProcess: runtime,
      spawn: () => {
        throw new Error("spawn should not be called");
      },
    });

    expect(() =>
      manager.startSession({
        cwd: "/workspace/repo",
        sessionId: "session-001",
        existingSessionId: "   ",
        approvalPolicy: "never",
        sandboxMode: "workspace-write",
      }),
    ).toThrow("Existing Codex session id must not be blank");
  });

  it("surfaces Codex startup failure and clears the active session slot", async () => {
    const runtime = new FakeRuntimeProcess();
    const startupError = new Error("spawn codex ENOENT");
    let spawnCount = 0;

    const manager = new CodexCliSessionManager({
      runtimeProcess: runtime,
      spawn: () => {
        const child = new FakeChildProcess();
        spawnCount += 1;
        queueMicrotask(() => {
          child.fail(startupError);
        });
        return child as never;
      },
    });

    const firstHandle = manager.startSession({
      cwd: "/workspace/repo",
      sessionId: "session-001",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
    });

    await expect(firstHandle.waitForExit()).rejects.toThrow("spawn codex ENOENT");

    const secondHandle = manager.startSession({
      cwd: "/workspace/repo",
      sessionId: "session-002",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
    });

    await expect(secondHandle.waitForExit()).rejects.toThrow("spawn codex ENOENT");
    expect(spawnCount).toBe(2);
  });

  it("forwards interruption signals to the child and removes handlers after exit", async () => {
    const runtime = new FakeRuntimeProcess();
    const child = new FakeChildProcess();

    const manager = new CodexCliSessionManager({
      runtimeProcess: runtime,
      spawn: () => child as never,
      setTimeout: ((handler: () => void) => {
        return setTimeout(handler, 0);
      }) as typeof globalThis.setTimeout,
      clearTimeout,
    });

    const handle = manager.startSession({
      cwd: "/workspace/repo",
      sessionId: "session-001",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      shutdownGracePeriodMs: 1_000,
    });

    expect(runtime.listenerCount("SIGINT")).toBe(1);
    expect(runtime.listenerCount("SIGTERM")).toBe(1);
    expect(runtime.listenerCount("SIGHUP")).toBe(1);
    expect(runtime.listenerCount("exit")).toBe(1);

    runtime.emit("SIGINT");
    expect(child.killCalls).toEqual(["SIGINT"]);

    child.finish(null, "SIGINT");

    await expect(handle.waitForExit()).resolves.toEqual({
      code: null,
      signal: "SIGINT",
    });
    expect(runtime.listenerCount("SIGINT")).toBe(0);
    expect(runtime.listenerCount("SIGTERM")).toBe(0);
    expect(runtime.listenerCount("SIGHUP")).toBe(0);
    expect(runtime.listenerCount("exit")).toBe(0);
  });

  it("supports explicit stop and escalates to SIGKILL if the child does not exit in time", async () => {
    const runtime = new FakeRuntimeProcess();
    const child = new FakeChildProcess();
    const scheduledHandlers: Array<() => void> = [];

    const manager = new CodexCliSessionManager({
      runtimeProcess: runtime,
      spawn: () => child as never,
      setTimeout: ((handler: () => void) => {
        scheduledHandlers.push(handler);
        return scheduledHandlers.length as never;
      }) as typeof globalThis.setTimeout,
      clearTimeout: (() => undefined) as typeof globalThis.clearTimeout,
    });

    const handle = manager.startSession({
      cwd: "/workspace/repo",
      sessionId: "session-001",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      shutdownGracePeriodMs: 50,
    });

    const exitPromise = handle.stop("SIGTERM");
    expect(child.killCalls).toEqual(["SIGTERM"]);

    scheduledHandlers[0]?.();
    expect(child.killCalls).toEqual(["SIGTERM", "SIGKILL"]);

    child.finish(null, "SIGKILL");

    await expect(exitPromise).resolves.toEqual({
      code: null,
      signal: "SIGKILL",
    });
  });

  it("reattaches to an active session without spawning a replacement process", () => {
    const runtime = new FakeRuntimeProcess();
    const child = new FakeChildProcess();
    let spawnCount = 0;

    const launcher = new CodexCliSessionManager({
      runtimeProcess: runtime,
      spawn: () => {
        spawnCount += 1;
        return child as never;
      },
    });
    const initialHandle = launcher.startSession({
      cwd: "/workspace/repo",
      sessionId: "session-001",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
    });

    const reattacher = new CodexCliSessionManager({
      runtimeProcess: runtime,
      spawn: () => {
        throw new Error("spawn should not be called when reattaching");
      },
    });
    const reattachedHandle = reattacher.reattachSession({
      sessionId: "session-001",
    });

    expect(spawnCount).toBe(1);
    expect(reattachedHandle).toBe(initialHandle);
  });
});

describe("Codex CLI session helpers", () => {
  it("builds interactive codex args with search enabled by default", () => {
    expect(
      buildCodexCliArgs({
        cwd: "/workspace/repo",
        sessionId: "session-001",
        approvalPolicy: "never",
        sandboxMode: "workspace-write",
      }),
    ).toEqual([
      "-C",
      "/workspace/repo",
      "-a",
      "never",
      "-s",
      "workspace-write",
      "--search",
    ]);
  });

  it("merges runtime and session environment for Codex launch", () => {
    expect(
      buildCodexCliEnvironment(
        {
          HOME: "/home/tester",
        },
        {
          cwd: "/workspace/repo",
          sessionId: "session-001",
          env: {
            CUSTOM_FLAG: "1",
          },
        },
      ),
    ).toMatchObject({
      HOME: "/home/tester",
      CUSTOM_FLAG: "1",
      INIT_CWD: "/workspace/repo",
      PWD: "/workspace/repo",
      RRX_AGENT: "codex_cli",
      RRX_SESSION_ID: "session-001",
    });
  });

  it("detects interactive terminals from stdin/stdout tty state", () => {
    expect(
      isInteractiveTerminal(
        { isTTY: true } as NodeJS.ReadableStream,
        { isTTY: true } as NodeJS.WritableStream,
      ),
    ).toBe(true);
    expect(
      isInteractiveTerminal(
        { isTTY: true } as NodeJS.ReadableStream,
        { isTTY: false } as NodeJS.WritableStream,
      ),
    ).toBe(false);
  });

  it("captures tty metadata for persisted lifecycle records", () => {
    expect(
      getCodexCliSessionTtyMetadata(
        { isTTY: true } as NodeJS.ReadableStream,
        { isTTY: true, columns: 132, rows: 43 } as NodeJS.WritableStream,
        {
          TERM: "screen-256color",
        },
      ),
    ).toEqual({
      stdinIsTty: true,
      stdoutIsTty: true,
      columns: 132,
      rows: 43,
      term: "screen-256color",
    });
  });
});
