import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export type CodexCliApprovalPolicy = "never" | "on-failure" | "on-request" | "untrusted";
export type CodexCliSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

type RuntimeEvent = NodeJS.Signals | "exit";
type RuntimeListener = (...args: unknown[]) => void;
type SpawnChildProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export interface CodexCliSessionLaunchOptions {
  cwd: string;
  sessionId: string;
  existingSessionId?: string;
  approvalPolicy: CodexCliApprovalPolicy;
  sandboxMode: CodexCliSandboxMode;
  command?: string;
  prompt?: string;
  model?: string;
  webSearch?: boolean;
  extraWritableDirectories?: string[];
  env?: Record<string, string>;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  shutdownGracePeriodMs?: number;
}

export interface CodexCliSessionExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface CodexCliSessionTtyMetadata {
  stdinIsTty: boolean;
  stdoutIsTty: boolean;
  columns?: number;
  rows?: number;
  term?: string;
}

export interface CodexCliSessionMetadata {
  launchMode: "new" | "resume";
  researchSessionId: string;
  codexSessionId?: string;
}

export interface CodexCliSessionHandle {
  pid: number | undefined;
  command: string;
  args: string[];
  metadata: CodexCliSessionMetadata;
  tty?: CodexCliSessionTtyMetadata;
  waitForExit(): Promise<CodexCliSessionExit>;
  stop(signal?: NodeJS.Signals): Promise<CodexCliSessionExit>;
}

export interface CodexCliSessionReattachOptions {
  sessionId: string;
  codexSessionId?: string;
}

export interface CodexCliSessionManagerDependencies {
  spawn?: SpawnChildProcess;
  runtimeProcess?: {
    env: NodeJS.ProcessEnv;
    stdin: NodeJS.ReadableStream;
    stdout: NodeJS.WritableStream;
    on(event: RuntimeEvent, listener: RuntimeListener): unknown;
    off(event: RuntimeEvent, listener: RuntimeListener): unknown;
  };
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
}

interface ActiveSession {
  sessionId: string;
  registryKeys: string[];
  handle: CodexCliSessionHandle;
  child: ChildProcess;
  closed: boolean;
  waitForExit: Promise<CodexCliSessionExit>;
}

const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
const DEFAULT_CODEX_COMMAND = "codex";
const DEFAULT_SHUTDOWN_GRACE_PERIOD_MS = 5_000;
const activeSessionRegistry = new Map<string, ActiveSession>();

export class CodexCliSessionManager {
  private readonly spawnChild: SpawnChildProcess;
  private readonly runtimeProcess: NonNullable<CodexCliSessionManagerDependencies["runtimeProcess"]>;
  private readonly setTimeoutFn: typeof globalThis.setTimeout;
  private readonly clearTimeoutFn: typeof globalThis.clearTimeout;

  private activeSession: ActiveSession | null = null;

  public constructor(dependencies: CodexCliSessionManagerDependencies = {}) {
    this.spawnChild = dependencies.spawn ?? spawn;
    this.runtimeProcess = dependencies.runtimeProcess ?? process;
    this.setTimeoutFn = dependencies.setTimeout ?? globalThis.setTimeout;
    this.clearTimeoutFn = dependencies.clearTimeout ?? globalThis.clearTimeout;
  }

  public startSession(options: CodexCliSessionLaunchOptions): CodexCliSessionHandle {
    if (this.activeSession && !this.activeSession.closed) {
      throw new Error("A Codex CLI session is already running");
    }

    const input = options.input ?? this.runtimeProcess.stdin;
    const output = options.output ?? this.runtimeProcess.stdout;
    if (!isInteractiveTerminal(input, output)) {
      throw new Error("Codex CLI requires an interactive terminal on stdin and stdout");
    }

    const command = options.command?.trim() || DEFAULT_CODEX_COMMAND;
    const args = buildCodexCliArgs(options);
    const env = buildCodexCliEnvironment(this.runtimeProcess.env, options);
    const tty = getCodexCliSessionTtyMetadata(input, output, env);
    const metadata = buildCodexCliSessionMetadata(options);
    const registryKeys = buildActiveSessionRegistryKeys(options.sessionId, metadata.codexSessionId);
    const child = this.spawnChild(command, args, {
      cwd: options.cwd,
      env,
      stdio: "inherit",
    });

    let resolveExit: ((value: CodexCliSessionExit) => void) | undefined;
    let rejectExit: ((reason?: unknown) => void) | undefined;
    let forceKillTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

    let activeSession: ActiveSession;

    const cleanup = (): void => {
      if (activeSession.closed) {
        return;
      }

      activeSession.closed = true;
      if (forceKillTimer) {
        this.clearTimeoutFn(forceKillTimer);
        forceKillTimer = undefined;
      }
      detachRuntimeHandlers();
      for (const key of activeSession.registryKeys) {
        activeSessionRegistry.delete(key);
      }
      if (this.activeSession === activeSession) {
        this.activeSession = null;
      }
    };

    const stop = (signal: NodeJS.Signals = "SIGTERM"): Promise<CodexCliSessionExit> => {
      if (!activeSession.closed && isChildRunning(child)) {
        child.kill(signal);

        if (!forceKillTimer) {
          forceKillTimer = this.setTimeoutFn(() => {
            if (activeSession.closed || !isChildRunning(child)) {
              return;
            }

            child.kill("SIGKILL");
          }, options.shutdownGracePeriodMs ?? DEFAULT_SHUTDOWN_GRACE_PERIOD_MS);
        }
      }

      return activeSession.waitForExit;
    };

    const handle: CodexCliSessionHandle = {
      pid: child.pid,
      command,
      args,
      metadata,
      tty,
      waitForExit: () => activeSession.waitForExit,
      stop,
    };

    activeSession = {
      sessionId: options.sessionId,
      registryKeys,
      handle,
      child,
      closed: false,
      waitForExit: new Promise<CodexCliSessionExit>((resolve, reject) => {
        resolveExit = resolve;
        rejectExit = reject;
      }),
    };
    this.activeSession = activeSession;
    for (const key of registryKeys) {
      activeSessionRegistry.set(key, activeSession);
    }

    const exitHandler = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      resolveExit?.({ code, signal });
    };

    const errorHandler = (error: Error): void => {
      cleanup();
      rejectExit?.(error);
    };

    child.once("exit", exitHandler);
    child.once("error", errorHandler);

    const detachRuntimeHandlers = this.attachRuntimeHandlers({
      onSignal: (signal) => {
        void stop(signal);
      },
      onExit: () => {
        if (activeSession.closed || !isChildRunning(child)) {
          return;
        }

        child.kill("SIGTERM");
      },
    });

    return handle;
  }

  public reattachSession(options: CodexCliSessionReattachOptions): CodexCliSessionHandle {
    if (this.activeSession && !this.activeSession.closed) {
      throw new Error("A Codex CLI session is already running");
    }

    const lookupKeys = buildReattachLookupKeys(options);
    const activeSession = lookupKeys
      .map((key) => activeSessionRegistry.get(key))
      .find((candidate) => candidate && !candidate.closed && isChildRunning(candidate.child));
    if (!activeSession) {
      throw new Error(`Active Codex CLI session not found for ${lookupKeys[0] ?? options.sessionId}`);
    }

    this.activeSession = activeSession;
    return activeSession.handle;
  }

  private attachRuntimeHandlers(handlers: {
    onSignal: (signal: NodeJS.Signals) => void;
    onExit: () => void;
  }): () => void {
    const boundHandlers = new Map<RuntimeEvent, RuntimeListener>();

    for (const signal of FORWARDED_SIGNALS) {
      const listener: RuntimeListener = () => {
        handlers.onSignal(signal);
      };
      boundHandlers.set(signal, listener);
      this.runtimeProcess.on(signal, listener);
    }

    const exitListener: RuntimeListener = () => {
      handlers.onExit();
    };
    boundHandlers.set("exit", exitListener);
    this.runtimeProcess.on("exit", exitListener);

    return () => {
      for (const [event, listener] of boundHandlers.entries()) {
        this.runtimeProcess.off(event, listener);
      }
    };
  }
}

export function buildCodexCliArgs(options: CodexCliSessionLaunchOptions): string[] {
  const baseArgs = [
    "-C",
    options.cwd,
    "-a",
    options.approvalPolicy,
    "-s",
    options.sandboxMode,
  ];

  if (options.model) {
    baseArgs.push("-m", options.model);
  }

  if (options.webSearch ?? true) {
    baseArgs.push("--search");
  }

  for (const directory of options.extraWritableDirectories ?? []) {
    baseArgs.push("--add-dir", directory);
  }

  const existingSessionId = normalizeExistingSessionId(options.existingSessionId);
  if (existingSessionId) {
    return [
      "resume",
      existingSessionId,
      ...baseArgs,
      ...(options.prompt ? [options.prompt] : []),
    ];
  }

  if (options.prompt) {
    baseArgs.push(options.prompt);
  }

  return baseArgs;
}

export function buildCodexCliEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  options: Pick<CodexCliSessionLaunchOptions, "cwd" | "env" | "sessionId">,
): NodeJS.ProcessEnv {
  return {
    ...baseEnvironment,
    ...options.env,
    INIT_CWD: options.cwd,
    PWD: options.cwd,
    RRX_AGENT: "codex_cli",
    RRX_SESSION_ID: options.sessionId,
  };
}

export function isInteractiveTerminal(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): boolean {
  return Boolean((input as { isTTY?: boolean }).isTTY && (output as { isTTY?: boolean }).isTTY);
}

export function getCodexCliSessionTtyMetadata(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  environment: NodeJS.ProcessEnv,
): CodexCliSessionTtyMetadata {
  const columns = (output as { columns?: number }).columns;
  const rows = (output as { rows?: number }).rows;

  return {
    stdinIsTty: Boolean((input as { isTTY?: boolean }).isTTY),
    stdoutIsTty: Boolean((output as { isTTY?: boolean }).isTTY),
    ...(columns && rows ? { columns, rows } : {}),
    ...(environment.TERM ? { term: environment.TERM } : {}),
  };
}

function isChildRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function buildCodexCliSessionMetadata(
  options: Pick<CodexCliSessionLaunchOptions, "sessionId" | "existingSessionId">,
): CodexCliSessionMetadata {
  const existingSessionId = normalizeExistingSessionId(options.existingSessionId);
  return {
    launchMode: existingSessionId ? "resume" : "new",
    researchSessionId: options.sessionId,
    ...(existingSessionId ? { codexSessionId: existingSessionId } : {}),
  };
}

function buildActiveSessionRegistryKeys(
  sessionId: string,
  codexSessionId: string | undefined,
): string[] {
  return [...new Set([sessionId, codexSessionId].filter((value): value is string => Boolean(value)))];
}

function buildReattachLookupKeys(options: CodexCliSessionReattachOptions): string[] {
  const sessionId = normalizeReattachLookupId(options.sessionId, "Research session id");
  const codexSessionId = options.codexSessionId === undefined
    ? undefined
    : normalizeReattachLookupId(options.codexSessionId, "Codex session id");

  return [...new Set([codexSessionId, sessionId].filter((value): value is string => Boolean(value)))];
}

function normalizeExistingSessionId(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Existing Codex session id must not be blank");
  }

  return normalized;
}

function normalizeReattachLookupId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be blank`);
  }

  return normalized;
}
