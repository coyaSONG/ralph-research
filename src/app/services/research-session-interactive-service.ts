import { realpath, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import {
  CodexCliSessionManager,
  type CodexCliSessionHandle,
} from "../../adapters/proposer/codex-cli-session-manager.js";
import { JsonFileResearchSessionRepository } from "../../adapters/fs/json-file-research-session-repository.js";
import { DEFAULT_STORAGE_ROOT } from "../../core/manifest/defaults.js";
import { type CodexCliSessionLifecyclePhase } from "../../core/model/codex-cli-session-lifecycle.js";
import {
  type ResearchSessionRecord,
} from "../../core/model/research-session.js";
import { ResearchSessionOrchestratorService, type ResearchSessionOrchestratorStepResult } from "./research-session-orchestrator-service.js";

export interface LaunchInteractiveResearchSessionInput {
  repoRoot: string;
  draftSessionId: string;
}

export interface ContinueInteractiveResearchSessionInput {
  repoRoot: string;
  sessionId: string;
}

export interface LaunchInteractiveResearchSessionResult {
  sessionId: string;
  lifecyclePath: string;
  started: ResearchSessionOrchestratorStepResult;
  finalized: ResearchSessionOrchestratorStepResult;
}

export interface ContinueInteractiveResearchSessionResult {
  sessionId: string;
  lifecyclePath: string;
  resumed: ResearchSessionOrchestratorStepResult;
  finalized: ResearchSessionOrchestratorStepResult;
}

export interface ResearchSessionInteractiveServiceDependencies {
  now?: () => Date;
  createOrchestrator?: () => Pick<
    ResearchSessionOrchestratorService,
    "startSession" | "continueSession" | "recordInterruption" | "failSession" | "recordCodexSessionLifecycle"
  >;
  createSessionManager?: () => Pick<CodexCliSessionManager, "startSession" | "reattachSession">;
}

export class ResearchSessionInteractiveService {
  private readonly createOrchestrator: NonNullable<
    ResearchSessionInteractiveServiceDependencies["createOrchestrator"]
  >;
  private readonly createSessionManager: NonNullable<
    ResearchSessionInteractiveServiceDependencies["createSessionManager"]
  >;

  public constructor(dependencies: ResearchSessionInteractiveServiceDependencies = {}) {
    this.createOrchestrator =
      dependencies.createOrchestrator ??
      (() =>
        new ResearchSessionOrchestratorService({
          ...(dependencies.now ? { now: dependencies.now } : {}),
        }));
    this.createSessionManager =
      dependencies.createSessionManager ?? (() => new CodexCliSessionManager());
  }

  public async launchFromDraft(
    input: LaunchInteractiveResearchSessionInput,
  ): Promise<LaunchInteractiveResearchSessionResult> {
    const canonicalRepoRoot = await resolveCanonicalRepoRoot(input.repoRoot);
    const orchestrator = this.createOrchestrator();
    const started = await orchestrator.startSession({
      repoRoot: canonicalRepoRoot,
      draftSessionId: input.draftSessionId,
    });
    const finalized = await this.runInteractiveSession({
      repoRoot: canonicalRepoRoot,
      session: started.session,
      orchestrator,
    });
    await deleteDraftSession(canonicalRepoRoot, input.draftSessionId);

    return {
      sessionId: started.session.sessionId,
      lifecyclePath: finalized.lifecyclePath,
      started,
      finalized: finalized.result,
    };
  }

  public async continueSession(
    input: ContinueInteractiveResearchSessionInput,
  ): Promise<ContinueInteractiveResearchSessionResult> {
    const canonicalRepoRoot = await resolveCanonicalRepoRoot(input.repoRoot);
    const orchestrator = this.createOrchestrator();
    const resumed = await orchestrator.continueSession({
      repoRoot: canonicalRepoRoot,
      sessionId: input.sessionId,
    });
    const finalized = await this.runInteractiveSession({
      repoRoot: canonicalRepoRoot,
      session: resumed.session,
      sessionResolution: resumed.cycle.sessionResolution,
      orchestrator,
    });

    return {
      sessionId: resumed.session.sessionId,
      lifecyclePath: finalized.lifecyclePath,
      resumed,
      finalized: finalized.result,
    };
  }

  private async runInteractiveSession(input: {
    repoRoot: string;
    session: ResearchSessionRecord;
    sessionResolution?: ResearchSessionOrchestratorStepResult["cycle"]["sessionResolution"];
    orchestrator: Pick<
      ResearchSessionOrchestratorService,
      "recordInterruption" | "failSession" | "recordCodexSessionLifecycle"
    >;
  }): Promise<{
    lifecyclePath: string;
    result: ResearchSessionOrchestratorStepResult;
  }> {
    const lifecyclePath = join(
      input.repoRoot,
      DEFAULT_STORAGE_ROOT,
      "sessions",
      input.session.sessionId,
      "codex-session.json",
    );
    const sessionManager = this.createSessionManager();

    try {
      await persistReplacementLifecycleRelease({
        repoRoot: input.repoRoot,
        sessionId: input.session.sessionId,
        sessionResolution: input.sessionResolution,
        orchestrator: input.orchestrator,
      });

      const handle = createSessionHandle({
        repoRoot: input.repoRoot,
        session: input.session,
        sessionResolution: input.sessionResolution,
        sessionManager,
      });
      const codexSessionId = getHandleCodexSessionId(handle);

      await input.orchestrator.recordCodexSessionLifecycle({
        repoRoot: input.repoRoot,
        sessionId: input.session.sessionId,
        phase: "running",
        command: handle.command,
        args: handle.args,
        ...(codexSessionId ? { codexSessionId } : {}),
        ...(handle.tty ? { tty: handle.tty } : {}),
        ...(handle.pid === undefined ? {} : { pid: handle.pid }),
        attachmentStatus: "bound",
      });

      try {
        const exit = await handle.waitForExit();
        const exitPhase = deriveExitPhase(exit);
        await input.orchestrator.recordCodexSessionLifecycle({
          repoRoot: input.repoRoot,
          sessionId: input.session.sessionId,
          phase: exitPhase,
          command: handle.command,
          args: handle.args,
          ...(codexSessionId ? { codexSessionId } : {}),
          exit,
          ...(handle.tty ? { tty: handle.tty } : {}),
          ...(handle.pid === undefined ? {} : { pid: handle.pid }),
          attachmentStatus: "released",
        });

        const lifecyclePathForRecord = toWorkspaceRelativePath(input.repoRoot, lifecyclePath);
        const result =
          exit.code === 0 && exit.signal === null
            ? await input.orchestrator.failSession({
                repoRoot: input.repoRoot,
                sessionId: input.session.sessionId,
                message: `Codex CLI session exited cleanly before explicitly completing the research session. Lifecycle evidence: ${lifecyclePathForRecord}`,
              })
            : exit.signal
              ? await input.orchestrator.recordInterruption({
                  repoRoot: input.repoRoot,
                  sessionId: input.session.sessionId,
                  note: `Codex CLI session exited from signal ${exit.signal} before cycle ${input.session.progress.nextCycle} completed. Lifecycle evidence: ${lifecyclePathForRecord}`,
                })
              : await input.orchestrator.failSession({
                  repoRoot: input.repoRoot,
                  sessionId: input.session.sessionId,
                  message: `Codex CLI session exited with code ${exit.code} before cycle ${input.session.progress.nextCycle} completed. Lifecycle evidence: ${lifecyclePathForRecord}`,
                });

        return {
          lifecyclePath: lifecyclePathForRecord,
          result,
        };
      } catch (error) {
        const normalized = normalizeError(error);
        await input.orchestrator.recordCodexSessionLifecycle({
          repoRoot: input.repoRoot,
          sessionId: input.session.sessionId,
          phase: "runtime_error",
          command: handle.command,
          args: handle.args,
          ...(codexSessionId ? { codexSessionId } : {}),
          error: normalized,
          ...(handle.tty ? { tty: handle.tty } : {}),
          ...(handle.pid === undefined ? {} : { pid: handle.pid }),
          attachmentStatus: "released",
        });

        const lifecyclePathForRecord = toWorkspaceRelativePath(input.repoRoot, lifecyclePath);
        const result = await input.orchestrator.failSession({
          repoRoot: input.repoRoot,
          sessionId: input.session.sessionId,
          message: `Codex CLI session failed while waiting for exit: ${normalized.message}. Lifecycle evidence: ${lifecyclePathForRecord}`,
          ...(normalized.stack ? { stack: normalized.stack } : {}),
        });

        return {
          lifecyclePath: lifecyclePathForRecord,
          result,
        };
      }
    } catch (error) {
      const normalized = normalizeError(error);
      await input.orchestrator.recordCodexSessionLifecycle({
        repoRoot: input.repoRoot,
        sessionId: input.session.sessionId,
        phase: "startup_error",
        error: normalized,
        attachmentStatus: "released",
      });

      const lifecyclePathForRecord = toWorkspaceRelativePath(input.repoRoot, lifecyclePath);
      const result = await input.orchestrator.failSession({
        repoRoot: input.repoRoot,
        sessionId: input.session.sessionId,
        message: `Codex CLI session failed to start: ${normalized.message}. Lifecycle evidence: ${lifecyclePathForRecord}`,
        ...(normalized.stack ? { stack: normalized.stack } : {}),
      });

      return {
        lifecyclePath: lifecyclePathForRecord,
        result,
      };
    }
  }
}

function createSessionHandle(input: {
  repoRoot: string;
  session: ResearchSessionRecord;
  sessionResolution?: ResearchSessionOrchestratorStepResult["cycle"]["sessionResolution"];
  sessionManager: Pick<CodexCliSessionManager, "startSession" | "reattachSession">;
}): CodexCliSessionHandle {
  if (input.sessionResolution?.decision === "reuse") {
    try {
      return input.sessionManager.reattachSession({
        sessionId: input.session.sessionId,
        codexSessionId: input.sessionResolution.codexSessionReference.codexSessionId,
      });
    } catch {
      const existingSessionId = getExistingCodexSessionId(input.session, input.sessionResolution);
      return input.sessionManager.startSession({
        cwd: input.session.workingDirectory,
        sessionId: input.session.sessionId,
        ...(existingSessionId ? { existingSessionId } : {}),
        command: input.session.agent.command,
        approvalPolicy: input.session.agent.approvalPolicy,
        sandboxMode: input.session.agent.sandboxMode,
        ...(input.session.agent.model ? { model: input.session.agent.model } : {}),
        prompt: input.session.goal,
        extraWritableDirectories: [input.repoRoot],
      });
    }
  }

  const existingSessionId = getExistingCodexSessionId(input.session, input.sessionResolution);

  return input.sessionManager.startSession({
    cwd: input.session.workingDirectory,
    sessionId: input.session.sessionId,
    ...(existingSessionId ? { existingSessionId } : {}),
    command: input.session.agent.command,
    approvalPolicy: input.session.agent.approvalPolicy,
    sandboxMode: input.session.agent.sandboxMode,
    ...(input.session.agent.model ? { model: input.session.agent.model } : {}),
    prompt: input.session.goal,
    extraWritableDirectories: [input.repoRoot],
  });
}

function getExistingCodexSessionId(
  session: Pick<ResearchSessionRecord, "sessionId">,
  sessionResolution: ResearchSessionOrchestratorStepResult["cycle"]["sessionResolution"] | undefined,
): string | undefined {
  if (!sessionResolution) {
    return undefined;
  }

  const normalizedResearchSessionId = session.sessionId.trim();
  if (sessionResolution.decision === "reuse") {
    return normalizeExternalCodexSessionId(
      normalizedResearchSessionId,
      sessionResolution.codexSessionReference.codexSessionId,
    );
  }

  if (sessionResolution.replace.attachabilityMode !== "resume") {
    return undefined;
  }

  return normalizeExternalCodexSessionId(
    normalizedResearchSessionId,
    sessionResolution.codexSessionReference?.codexSessionId ??
      sessionResolution.lifecycle?.identity.codexSessionId,
  );
}

function normalizeExternalCodexSessionId(
  researchSessionId: string,
  codexSessionId: string | undefined,
): string | undefined {
  if (codexSessionId === undefined) {
    return undefined;
  }

  const normalizedCodexSessionId = codexSessionId.trim();
  if (!normalizedCodexSessionId || normalizedCodexSessionId === researchSessionId) {
    return undefined;
  }

  return normalizedCodexSessionId;
}

function getHandleCodexSessionId(handle: CodexCliSessionHandle): string | undefined {
  const metadata = (handle as Partial<CodexCliSessionHandle>).metadata;
  return typeof metadata?.codexSessionId === "string" && metadata.codexSessionId.length > 0
    ? metadata.codexSessionId
    : undefined;
}

async function resolveCanonicalRepoRoot(repoRoot: string): Promise<string> {
  const resolvedRoot = resolve(repoRoot);
  const repoStats = await stat(resolvedRoot).catch(() => null);
  if (!repoStats?.isDirectory()) {
    throw new Error(`Working directory is not a directory: ${resolvedRoot}`);
  }

  return realpath(resolvedRoot);
}

function deriveExitPhase(exit: { code: number | null; signal: NodeJS.Signals | null }): CodexCliSessionLifecyclePhase {
  if (exit.signal) {
    return "signaled";
  }

  if (exit.code === 0) {
    return "clean_exit";
  }

  return "non_zero_exit";
}

function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  return {
    message: String(error),
  };
}

function toWorkspaceRelativePath(repoRoot: string, path: string): string {
  const relativePath = relative(repoRoot, path);
  return relativePath.length === 0 ? "." : relativePath;
}

async function persistReplacementLifecycleRelease(input: {
  repoRoot: string;
  sessionId: string;
  sessionResolution?: ResearchSessionOrchestratorStepResult["cycle"]["sessionResolution"];
  orchestrator: Pick<ResearchSessionOrchestratorService, "recordCodexSessionLifecycle">;
}): Promise<void> {
  if (input.sessionResolution?.decision !== "replace" || !input.sessionResolution.lifecycle) {
    return;
  }

  const lifecycle = input.sessionResolution.lifecycle;
  await input.orchestrator.recordCodexSessionLifecycle({
    repoRoot: input.repoRoot,
    sessionId: input.sessionId,
    phase: lifecycle.phase,
    command: lifecycle.command,
    args: lifecycle.args,
    ...(lifecycle.pid === undefined ? {} : { pid: lifecycle.pid }),
    tty: lifecycle.tty,
    ...(lifecycle.exit ? { exit: lifecycle.exit } : {}),
    ...(lifecycle.error ? { error: lifecycle.error } : {}),
    attachmentStatus: "released",
  });
}

async function deleteDraftSession(repoRoot: string, draftSessionId: string): Promise<void> {
  const repository = new JsonFileResearchSessionRepository(join(repoRoot, DEFAULT_STORAGE_ROOT, "sessions"));
  await repository.deleteSession?.(draftSessionId);
}
