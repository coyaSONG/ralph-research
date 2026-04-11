import { randomUUID } from "node:crypto";

import type { CodexCliProposerConfig } from "../../core/manifest/schema.js";
import type { CodexCliSessionExit, CodexCliSessionHandle } from "./codex-cli-session-manager.js";
import { CodexCliSessionManager } from "./codex-cli-session-manager.js";
import type { ProposalExecutionInput, ProposalExecutionResult, ProposerRunner } from "./proposer-factory.js";

export interface CodexCliSessionProposerDependencies {
  createSessionManager?: () => CodexCliSessionManager;
  createSessionId?: () => string;
  now?: () => Date;
}

export class CodexCliSessionProposer implements ProposerRunner {
  private readonly sessionManager: CodexCliSessionManager;
  private readonly createSessionId: () => string;
  private readonly now: () => Date;

  public constructor(
    private readonly config: CodexCliProposerConfig,
    dependencies: CodexCliSessionProposerDependencies = {},
  ) {
    this.sessionManager = dependencies.createSessionManager?.() ?? new CodexCliSessionManager();
    this.createSessionId = dependencies.createSessionId ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date());
  }

  public async run(input: ProposalExecutionInput): Promise<ProposalExecutionResult> {
    const sessionId = input.codexSession?.researchSessionId ?? this.createSessionId();
    const existingSessionId = input.codexSession?.existingCodexSessionId;
    const startedAt = this.now().getTime();

    let session: CodexCliSessionHandle;
    try {
      session = this.sessionManager.startSession({
        cwd: input.workspacePath,
        sessionId,
        ...(existingSessionId ? { existingSessionId } : {}),
        approvalPolicy: this.config.approvalPolicy,
        sandboxMode: this.config.sandboxMode,
        ...(this.config.model ? { model: this.config.model } : {}),
        ...(input.env ? { env: input.env } : {}),
      });
    } catch (error) {
      throw new Error(`codex_cli proposer failed to start: ${formatErrorMessage(error)}`);
    }

    const timeoutMs = this.config.ttySession.turnTimeoutSec * 1_000;

    let exit: CodexCliSessionExit;
    try {
      exit = await waitForExitWithTimeout(session, timeoutMs);
    } catch (error) {
      throw new Error(`codex_cli proposer session failed: ${formatErrorMessage(error)}`);
    }

    if (exit.signal) {
      throw new Error(`codex_cli proposer exited from signal ${exit.signal}`);
    }

    if (exit.code !== 0) {
      throw new Error(`codex_cli proposer exited with code ${exit.code}`);
    }

    const durationMs = this.now().getTime() - startedAt;
    const summarySessionId = getAuthoritativeCodexSessionId(session, sessionId);
    const summary = `codex_cli session ${summarySessionId} completed with exit code 0 in ${durationMs}ms`;

    return {
      proposerType: "codex_cli",
      stdout: "",
      stderr: "",
      summary,
      adapterMetadata: {
        adapter: "codex_cli",
        invocation: {
          sessionId,
          command: session.command,
          args: session.args,
          cwd: input.workspacePath,
          sessionMetadata: session.metadata,
        },
        outcome: {
          kind: "terminal_exit",
          code: exit.code,
          signal: exit.signal,
          durationMs,
          summary,
        },
      },
    };
  }
}

function getAuthoritativeCodexSessionId(
  session: CodexCliSessionHandle,
  fallbackSessionId: string,
): string {
  const metadata = (session as Partial<CodexCliSessionHandle>).metadata;
  if (typeof metadata?.codexSessionId === "string" && metadata.codexSessionId.length > 0) {
    return metadata.codexSessionId;
  }

  if (typeof metadata?.researchSessionId === "string" && metadata.researchSessionId.length > 0) {
    return metadata.researchSessionId;
  }

  return fallbackSessionId;
}

async function waitForExitWithTimeout(
  session: CodexCliSessionHandle,
  timeoutMs: number,
): Promise<CodexCliSessionExit> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<CodexCliSessionExit>((_, reject) => {
    timeoutId = setTimeout(() => {
      void session.stop("SIGTERM").catch(() => undefined);
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timeoutId.unref?.();
  });

  try {
    return await Promise.race([session.waitForExit(), timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
