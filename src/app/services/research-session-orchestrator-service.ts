import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { JsonFileResearchSessionRepository } from "../../adapters/fs/json-file-research-session-repository.js";
import { DEFAULT_STORAGE_ROOT } from "../../core/manifest/defaults.js";
import type { CodexCliCycleSessionContext } from "../../core/model/codex-cli-cycle-session.js";
import type { DecisionRecord } from "../../core/model/decision-record.js";
import {
  CodexCliSessionLifecycleService,
  type CodexCliSessionReuseOrReplaceDecision,
} from "./codex-cli-session-lifecycle-service.js";
import {
  parseCodexCliSessionLifecycleRecord,
  serializeCodexCliSessionLifecycleRecord,
  type CodexCliSessionLifecycleError,
  type CodexCliSessionLifecycleExit,
  type CodexCliSessionLifecyclePhase,
  type CodexCliSessionLifecycleRecord,
  type CodexCliSessionTty,
} from "../../core/model/codex-cli-session-lifecycle.js";
import {
  RESUMABLE_RESEARCH_SESSION_STATUSES,
  isResumableResearchSessionStatus,
  type ResearchSessionProgressSignal,
  type ResearchSessionRecord,
  type ResearchSessionStopCondition,
  type ResumableResearchSessionStatus,
} from "../../core/model/research-session.js";
import type { RunRecord } from "../../core/model/run-record.js";
import type { ResearchSessionRepository } from "../../core/ports/research-session-repository.js";
import {
  advanceResearchSessionCompletedCycle,
  completeResearchSession,
  failResearchSession,
  haltResearchSession,
  interruptResearchSession,
  resumeResearchSession,
  startResearchSessionFromDraft,
} from "../../core/state/research-session-state-machine.js";
import { ResearchSessionRecoveryService } from "./research-session-recovery-service.js";
import { RunCycleService, type RunCycleServiceResult } from "./run-cycle-service.js";

export type ResearchSessionOrchestratorStep =
  | "session_started"
  | "session_resumed"
  | "cycle_executed"
  | "cycle_checkpointed"
  | "session_interrupted"
  | "session_halted"
  | "session_completed"
  | "session_failed";

export interface ResearchSessionCycleView {
  completedCycles: number;
  nextCycle: number;
  latestRunId?: string;
  latestDecisionId?: string;
  latestFrontierIds: string[];
  lastSignals?: ResearchSessionProgressSignal;
  sessionResolution?: CodexCliSessionReuseOrReplaceDecision;
  run?: RunRecord;
  decision?: DecisionRecord | null;
  runResult?: RunCycleServiceResult;
}

export interface ResearchSessionOrchestratorStepResult {
  step: ResearchSessionOrchestratorStep;
  session: ResearchSessionRecord;
  cycle: ResearchSessionCycleView;
}

export interface ResearchSessionOrchestratorServiceDependencies {
  now?: () => Date;
  createSessionId?: () => string;
  createRepository?: (sessionsRoot: string) => ResearchSessionRepository;
  recoveryService?: Pick<ResearchSessionRecoveryService, "classifySession">;
  createRecoveryService?: () => Pick<ResearchSessionRecoveryService, "classifySession">;
  lifecycleService?: Pick<CodexCliSessionLifecycleService, "resolveCycleSession">;
  createLifecycleService?: () => Pick<CodexCliSessionLifecycleService, "resolveCycleSession">;
  runCycleService?: Pick<RunCycleService, "run">;
  createRunCycleService?: () => Pick<RunCycleService, "run">;
}

export interface StartResearchSessionInput {
  repoRoot: string;
  draftSessionId: string;
}

export interface ResumeResearchSessionInput {
  repoRoot: string;
  sessionId: string;
}

export interface ContinueResearchSessionInput extends ResumeResearchSessionInput {}

export interface RecordResearchCycleInput {
  repoRoot: string;
  sessionId: string;
  run: RunRecord;
  decision: DecisionRecord | null;
  frontierIds: string[];
  signal: Omit<ResearchSessionProgressSignal, "cycle">;
}

export interface RecordResearchSessionInterruptionInput {
  repoRoot: string;
  sessionId: string;
  note?: string;
}

export interface ExecuteResearchSessionCycleInput {
  repoRoot: string;
  sessionId: string;
  manifestPath?: string;
  fresh?: boolean;
}

export interface StepResearchSessionInput extends ExecuteResearchSessionCycleInput {}

export interface RunResearchSessionCyclesInput extends StepResearchSessionInput {
  maxCycles?: number;
}

export interface RunResearchSessionCyclesResult {
  cyclesExecuted: number;
  steps: ResearchSessionOrchestratorStepResult[];
  session: ResearchSessionRecord;
}

export interface HaltResearchSessionInput {
  repoRoot: string;
  sessionId: string;
  stopCondition: Extract<
    ResearchSessionStopCondition,
    { type: "repeated_failures" | "no_meaningful_progress" | "insufficient_evidence" | "operator_stop" }
  >;
}

export interface CompleteResearchSessionInput {
  repoRoot: string;
  sessionId: string;
  summary: string;
  evidenceBundlePath: string;
  achievedAtCycle?: number;
  promotion?: {
    promotedRunId: string;
    promotedDecisionId: string;
    promotedCommitSha: string;
  };
}

export interface FailResearchSessionInput {
  repoRoot: string;
  sessionId: string;
  message: string;
  stack?: string;
}

export interface RecordCodexSessionLifecycleInput {
  repoRoot: string;
  sessionId: string;
  at?: string;
  phase?: CodexCliSessionLifecyclePhase;
  command?: string;
  args?: string[];
  codexSessionId?: string;
  pid?: number;
  tty?: Partial<CodexCliSessionTty>;
  exit?: CodexCliSessionLifecycleExit;
  error?: CodexCliSessionLifecycleError;
  attachmentStatus?: "bound" | "released" | "unknown";
}

export class ResearchSessionOrchestratorService {
  private readonly now: () => Date;
  private readonly createSessionId: () => string;
  private readonly createRepository: (sessionsRoot: string) => ResearchSessionRepository;
  private readonly recoveryService: Pick<ResearchSessionRecoveryService, "classifySession">;
  private readonly lifecycleService: Pick<CodexCliSessionLifecycleService, "resolveCycleSession">;
  private readonly runCycleService: Pick<RunCycleService, "run">;

  public constructor(dependencies: ResearchSessionOrchestratorServiceDependencies = {}) {
    this.now = dependencies.now ?? (() => new Date());
    this.createSessionId = dependencies.createSessionId ?? (() => `session-${Date.now()}`);
    this.createRepository =
      dependencies.createRepository ??
      ((sessionsRoot) => new JsonFileResearchSessionRepository(sessionsRoot));
    this.recoveryService =
      dependencies.recoveryService ??
      dependencies.createRecoveryService?.() ??
      new ResearchSessionRecoveryService({
        createRepository: this.createRepository,
      });
    this.lifecycleService =
      dependencies.lifecycleService ??
      dependencies.createLifecycleService?.() ??
      new CodexCliSessionLifecycleService({
        createRecoveryService: () =>
          new ResearchSessionRecoveryService({
            createRepository: this.createRepository,
          }),
      });
    this.runCycleService =
      dependencies.runCycleService ??
      dependencies.createRunCycleService?.() ??
      new RunCycleService({
        ...(dependencies.now ? { now: dependencies.now } : {}),
      });
  }

  public async startSession(input: StartResearchSessionInput): Promise<ResearchSessionOrchestratorStepResult> {
    const { canonicalRepoRoot, repository } = await this.resolveRepository(input.repoRoot);
    const draft = await this.loadSessionOrThrow(repository, input.draftSessionId);
    const at = this.now().toISOString();

    const sessionId = normalizeRequiredString(this.createSessionId(), "Session id");
    const existing = await repository.loadSession(sessionId);
    if (existing) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    const nextRecord = startResearchSessionFromDraft({
      draft,
      sessionId,
      at,
    });

    await repository.saveSession(nextRecord);
    await this.recordCodexSessionLifecycle({
      repoRoot: canonicalRepoRoot,
      sessionId: nextRecord.sessionId,
      at,
      phase: "starting",
      command: nextRecord.agent.command,
      args: [],
      attachmentStatus: "unknown",
    });
    return toStepResult("session_started", nextRecord);
  }

  public async resumeSession(input: ResumeResearchSessionInput): Promise<ResearchSessionOrchestratorStepResult> {
    const { canonicalRepoRoot, repository } = await this.resolveRepository(input.repoRoot);
    const current = await this.loadSessionOrThrow(repository, input.sessionId);
    const resumableStatus = assertResumableSessionStatus(current);
    await this.assertResumeSafety(input, current, resumableStatus);
    const persisted = await this.loadSessionOrThrow(repository, input.sessionId);
    assertResumableSessionStatus(persisted);
    const at = this.now().toISOString();
    if (!persisted.resume.resumable) {
      throw new Error(
        `Session ${persisted.sessionId} cannot resume from status ${persisted.status} because its checkpoint is not marked resumable`,
      );
    }

    const nextRecord = resumeResearchSession({
      current: persisted,
      at,
    });

    await repository.saveSession(nextRecord);
    await this.recordCodexSessionLifecycle({
      repoRoot: canonicalRepoRoot,
      sessionId: nextRecord.sessionId,
      at,
      phase: "starting",
      command: nextRecord.agent.command,
      args: [],
      attachmentStatus: "unknown",
    });
    return toStepResult("session_resumed", nextRecord);
  }

  public async continueSession(
    input: ContinueResearchSessionInput,
  ): Promise<ResearchSessionOrchestratorStepResult> {
    const { canonicalRepoRoot, repository } = await this.resolveRepository(input.repoRoot);
    const current = await this.loadSessionOrThrow(repository, input.sessionId);
    const resumableStatus = assertResumableSessionStatus(current);

    if (resumableStatus === "running") {
      const sessionResolution = await this.lifecycleService.resolveCycleSession({
        repoRoot: canonicalRepoRoot,
        sessionId: input.sessionId,
      });
      return toStepResult("session_resumed", current, {
        sessionResolution,
      });
    }

    await this.assertResumeSafety(input, current, resumableStatus);
    return this.resumeSession(input);
  }

  public async executeCycle(
    input: ExecuteResearchSessionCycleInput,
  ): Promise<ResearchSessionOrchestratorStepResult> {
    const { canonicalRepoRoot, repository } = await this.resolveRepository(input.repoRoot);
    const current = await this.loadSessionOrThrow(repository, input.sessionId);
    if (current.status !== "running") {
      throw new Error(`Session ${current.sessionId} cannot execute a cycle from status ${current.status}`);
    }

    const sessionResolution = await this.lifecycleService.resolveCycleSession({
      repoRoot: canonicalRepoRoot,
      sessionId: input.sessionId,
    });

    const runResult = await this.runCycleService.run({
      repoRoot: canonicalRepoRoot,
      ...(input.manifestPath ? { manifestPath: input.manifestPath } : {}),
      ...(input.fresh !== undefined ? { fresh: input.fresh } : {}),
      codexSession: buildCodexCliCycleSessionContext(input.sessionId, sessionResolution),
    });

    const frontierIds = runResult.runResult?.frontier.map((entry) => entry.frontierId) ?? current.progress.latestFrontierIds;
    const cycleView: Partial<ResearchSessionCycleView> = {
      latestFrontierIds: frontierIds,
      sessionResolution,
      runResult,
      ...(runResult.runResult?.run ? { run: runResult.runResult.run } : {}),
      ...(runResult.runResult ? { decision: runResult.runResult.decision ?? null } : {}),
    };
    return toStepResult("cycle_executed", current, cycleView);
  }

  public async step(input: StepResearchSessionInput): Promise<ResearchSessionOrchestratorStepResult> {
    const executed = await this.executeCycle(input);
    const run = executed.cycle.run;
    const frontierIds = executed.cycle.latestFrontierIds;
    const decision = executed.cycle.decision ?? null;

    if (!run) {
      throw new Error(`Run cycle did not produce a persisted run for session ${input.sessionId}`);
    }

    const finalized = await this.recordCompletedCycle({
      repoRoot: input.repoRoot,
      sessionId: input.sessionId,
      run,
      decision,
      frontierIds,
      signal: createProgressSignal({
        previousSession: executed.session,
        run,
        decision,
        frontierIds,
      }),
    });
    return toStepResult(finalized.step, finalized.session, {
      latestFrontierIds: frontierIds,
      run,
      decision,
      ...(executed.cycle.runResult ? { runResult: executed.cycle.runResult } : {}),
    });
  }

  public async runCycles(input: RunResearchSessionCyclesInput): Promise<RunResearchSessionCyclesResult> {
    const maxCycles = input.maxCycles ?? null;
    if (maxCycles !== null && maxCycles < 1) {
      throw new Error("maxCycles must be a positive integer");
    }

    const { repository } = await this.resolveRepository(input.repoRoot);
    let session = await this.loadSessionOrThrow(repository, input.sessionId);
    const steps: ResearchSessionOrchestratorStepResult[] = [];

    while (session.status === "running" && (maxCycles === null || steps.length < maxCycles)) {
      const stepped = await this.step(input);
      steps.push(stepped);

      // Reload persisted session state before scheduling the next cycle so terminal
      // and stop-requested transitions created at the cycle boundary are respected.
      session = await this.loadSessionOrThrow(repository, input.sessionId);
    }

    return {
      cyclesExecuted: steps.length,
      steps,
      session,
    };
  }

  public async recordCompletedCycle(
    input: RecordResearchCycleInput,
  ): Promise<ResearchSessionOrchestratorStepResult> {
    const { canonicalRepoRoot, repository } = await this.resolveRepository(input.repoRoot);
    const current = await this.loadSessionOrThrow(repository, input.sessionId);
    const at = this.now().toISOString();
    const advanced = advanceResearchSessionCompletedCycle({
      current,
      run: input.run,
      decision: input.decision,
      frontierIds: input.frontierIds,
      signal: input.signal,
      at,
    });

    await repository.saveSession(advanced.session);
    await this.recordCodexSessionLifecycle({
      repoRoot: canonicalRepoRoot,
      sessionId: advanced.session.sessionId,
      at,
    });
    return toStepResult(advanced.transition, advanced.session, {
      run: input.run,
      decision: input.decision,
      latestFrontierIds: advanced.session.progress.latestFrontierIds,
    });
  }

  public async recordInterruption(
    input: RecordResearchSessionInterruptionInput,
  ): Promise<ResearchSessionOrchestratorStepResult> {
    const { canonicalRepoRoot, repository } = await this.resolveRepository(input.repoRoot);
    const current = await this.loadSessionOrThrow(repository, input.sessionId);
    const at = this.now().toISOString();
    const nextRecord = interruptResearchSession({
      current,
      at,
      ...(input.note !== undefined ? { note: input.note } : {}),
    });

    await repository.saveSession(nextRecord);
    await this.recordCodexSessionLifecycle({
      repoRoot: canonicalRepoRoot,
      sessionId: nextRecord.sessionId,
      at,
      attachmentStatus: "released",
    });
    return toStepResult("session_interrupted", nextRecord);
  }

  public async haltSession(input: HaltResearchSessionInput): Promise<ResearchSessionOrchestratorStepResult> {
    const { canonicalRepoRoot, repository } = await this.resolveRepository(input.repoRoot);
    const current = await this.loadSessionOrThrow(repository, input.sessionId);
    const at = this.now().toISOString();
    const nextRecord = haltResearchSession({
      current,
      stopCondition: input.stopCondition,
      at,
    });

    await repository.saveSession(nextRecord);
    await this.recordCodexSessionLifecycle({
      repoRoot: canonicalRepoRoot,
      sessionId: nextRecord.sessionId,
      at,
      attachmentStatus: "released",
    });
    return toStepResult("session_halted", nextRecord);
  }

  public async completeSession(input: CompleteResearchSessionInput): Promise<ResearchSessionOrchestratorStepResult> {
    const { canonicalRepoRoot, repository } = await this.resolveRepository(input.repoRoot);
    const current = await this.loadSessionOrThrow(repository, input.sessionId);
    const at = this.now().toISOString();
    const nextRecord = completeResearchSession({
      current,
      summary: input.summary,
      evidenceBundlePath: input.evidenceBundlePath,
      at,
      ...(input.achievedAtCycle !== undefined ? { achievedAtCycle: input.achievedAtCycle } : {}),
      ...(input.promotion ? { promotion: input.promotion } : {}),
    });

    await repository.saveSession(nextRecord);
    await this.recordCodexSessionLifecycle({
      repoRoot: canonicalRepoRoot,
      sessionId: nextRecord.sessionId,
      at,
      attachmentStatus: "released",
    });
    return toStepResult("session_completed", nextRecord);
  }

  public async failSession(input: FailResearchSessionInput): Promise<ResearchSessionOrchestratorStepResult> {
    const { canonicalRepoRoot, repository } = await this.resolveRepository(input.repoRoot);
    const current = await this.loadSessionOrThrow(repository, input.sessionId);
    const at = this.now().toISOString();
    const nextRecord = failResearchSession({
      current,
      message: input.message,
      at,
      ...(input.stack !== undefined ? { stack: input.stack } : {}),
    });

    await repository.saveSession(nextRecord);
    await this.recordCodexSessionLifecycle({
      repoRoot: canonicalRepoRoot,
      sessionId: nextRecord.sessionId,
      at,
      attachmentStatus: "released",
    });
    return toStepResult("session_failed", nextRecord);
  }

  public async recordCodexSessionLifecycle(
    input: RecordCodexSessionLifecycleInput,
  ): Promise<CodexCliSessionLifecycleRecord> {
    const { canonicalRepoRoot, repository } = await this.resolveRepository(input.repoRoot);
    const session = await this.loadSessionOrThrow(repository, input.sessionId);
    const at = input.at ?? this.now().toISOString();
    const sessionForLifecycle = refreshSessionLifecycleTimestamp(session, at);
    if (sessionForLifecycle !== session) {
      await repository.saveSession(sessionForLifecycle);
    }

    const existing = await this.loadLifecycle(canonicalRepoRoot, input.sessionId);
    const nextRecord = mergeCodexSessionLifecycleRecord({
      repoRoot: canonicalRepoRoot,
      session: sessionForLifecycle,
      existing,
      at,
      ...(input.phase ? { phase: input.phase } : {}),
      ...(input.command ? { command: input.command } : {}),
      ...(input.args ? { args: input.args } : {}),
      ...(input.codexSessionId ? { codexSessionId: input.codexSessionId } : {}),
      ...(input.pid !== undefined ? { pid: input.pid } : {}),
      ...(input.tty ? { tty: input.tty } : {}),
      ...(input.exit ? { exit: input.exit } : {}),
      ...(input.error ? { error: input.error } : {}),
      ...(input.attachmentStatus ? { attachmentStatus: input.attachmentStatus } : {}),
    });

    await persistCodexSessionLifecycle(
      getCodexSessionLifecyclePath(canonicalRepoRoot, input.sessionId),
      nextRecord,
    );
    return nextRecord;
  }

  private async resolveRepository(repoRoot: string): Promise<{
    canonicalRepoRoot: string;
    repository: ResearchSessionRepository;
  }> {
    const resolvedRoot = resolve(repoRoot);
    const repoStats = await stat(resolvedRoot).catch(() => null);
    if (!repoStats?.isDirectory()) {
      throw new Error(`Working directory is not a directory: ${resolvedRoot}`);
    }

    const canonicalRepoRoot = await realpath(resolvedRoot);
    const storageRoot = join(canonicalRepoRoot, DEFAULT_STORAGE_ROOT);
    const sessionsRoot = join(storageRoot, "sessions");

    return {
      canonicalRepoRoot,
      repository: this.createRepository(sessionsRoot),
    };
  }

  private async loadSessionOrThrow(
    repository: ResearchSessionRepository,
    sessionId: string,
  ): Promise<ResearchSessionRecord> {
    const session = await repository.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }

  private async assertResumeSafety(
    input: ResumeResearchSessionInput,
    session: ResearchSessionRecord,
    status: ResumableResearchSessionStatus,
  ): Promise<void> {
    const recovery = await this.recoveryService.classifySession({
      repoRoot: input.repoRoot,
      sessionId: input.sessionId,
    });
    if (!recovery.resumeAllowed) {
      throw new Error(`Session ${session.sessionId} cannot resume safely: ${recovery.reason}`);
    }
  }

  private async loadLifecycle(
    repoRoot: string,
    sessionId: string,
  ): Promise<CodexCliSessionLifecycleRecord | null> {
    const lifecyclePath = getCodexSessionLifecyclePath(repoRoot, sessionId);

    try {
      const raw = await readFile(lifecyclePath, "utf8");
      return parseCodexCliSessionLifecycleRecord(raw);
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }
}

function assertResumableSessionStatus(
  session: ResearchSessionRecord,
): ResumableResearchSessionStatus {
  if (!isResumableResearchSessionStatus(session.status)) {
    throw new Error(
      `Session ${session.sessionId} cannot resume from status ${session.status}; resumable statuses: ${RESUMABLE_RESEARCH_SESSION_STATUSES.join(", ")}`,
    );
  }

  return session.status;
}

function normalizeRequiredString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function getCodexSessionLifecyclePath(repoRoot: string, sessionId: string): string {
  return join(repoRoot, DEFAULT_STORAGE_ROOT, "sessions", sessionId, "codex-session.json");
}

async function persistCodexSessionLifecycle(
  path: string,
  record: CodexCliSessionLifecycleRecord,
): Promise<void> {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tempPath, serializeCodexCliSessionLifecycleRecord(record), "utf8");
  await rename(tempPath, path);
}

function mergeCodexSessionLifecycleRecord(input: {
  repoRoot: string;
  session: ResearchSessionRecord;
  existing: CodexCliSessionLifecycleRecord | null;
  at: string;
  phase?: CodexCliSessionLifecyclePhase;
  command?: string;
  args?: string[];
  codexSessionId?: string;
  pid?: number;
  tty?: Partial<CodexCliSessionTty>;
  exit?: CodexCliSessionLifecycleExit;
  error?: CodexCliSessionLifecycleError;
  attachmentStatus?: "bound" | "released" | "unknown";
}): CodexCliSessionLifecycleRecord {
  const checkpointRunId = input.session.resume.checkpointRunId ?? input.session.progress.latestRunId;
  const checkpointDecisionId = input.session.resume.checkpointDecisionId ?? input.session.progress.latestDecisionId;
  const phase = input.phase ?? input.existing?.phase ?? "starting";
  const attachmentStatus = input.attachmentStatus ?? deriveAttachmentStatus(input.session);
  const record: CodexCliSessionLifecycleRecord = {
    sessionId: input.session.sessionId,
    workingDirectory: input.session.workingDirectory,
    goal: input.session.goal,
    resumeFromCycle: input.session.resume.resumeFromCycle,
    completedCycles: input.session.progress.completedCycles,
    command: input.command ?? input.existing?.command ?? input.session.agent.command,
    args: input.args ?? input.existing?.args ?? [],
    approvalPolicy: input.session.agent.approvalPolicy,
    sandboxMode: input.session.agent.sandboxMode,
    ...(input.session.agent.model ? { model: input.session.agent.model } : {}),
    startedAt: input.existing?.startedAt ?? input.at,
    updatedAt: input.at,
    phase,
    identity: {
      researchSessionId: input.session.sessionId,
      codexSessionId:
        normalizePersistedCodexSessionId(input.codexSessionId) ??
        input.existing?.identity.codexSessionId ??
        input.session.sessionId,
      agent: "codex_cli",
    },
    tty: {
      stdinIsTty: input.tty?.stdinIsTty ?? input.existing?.tty.stdinIsTty ?? true,
      stdoutIsTty: input.tty?.stdoutIsTty ?? input.existing?.tty.stdoutIsTty ?? true,
      ...(input.tty?.columns !== undefined
        ? { columns: input.tty.columns }
        : input.existing?.tty.columns !== undefined
          ? { columns: input.existing.tty.columns }
          : {}),
      ...(input.tty?.rows !== undefined
        ? { rows: input.tty.rows }
        : input.existing?.tty.rows !== undefined
          ? { rows: input.existing.tty.rows }
          : {}),
      ...(input.tty?.term !== undefined
        ? { term: input.tty.term }
        : input.existing?.tty.term !== undefined
          ? { term: input.existing.tty.term }
          : {}),
      startupTimeoutSec: input.session.agent.ttySession.startupTimeoutSec,
      turnTimeoutSec: input.session.agent.ttySession.turnTimeoutSec,
    },
    attachmentState: {
      mode: "working_directory",
      status: attachmentStatus,
      workingDirectory: input.session.workingDirectory,
      trackedGlobs: [...input.session.context.trackableGlobs],
      attachedPaths: [],
      extraWritableDirectories: dedupePaths([input.session.workingDirectory, input.repoRoot]),
    },
    references: {
      ...(input.session.workspace.currentRef ? { workspaceRef: input.session.workspace.currentRef } : {}),
      ...(input.session.workspace.currentPath ? { workspacePath: input.session.workspace.currentPath } : {}),
      ...(checkpointRunId ? { checkpointRunId } : {}),
      ...(checkpointDecisionId ? { checkpointDecisionId } : {}),
    },
    ...(input.pid !== undefined
      ? { pid: input.pid }
      : input.existing?.pid !== undefined
        ? { pid: input.existing.pid }
        : {}),
  };

  if (phase === "starting" || phase === "running") {
    return record;
  }

  return {
    ...record,
    endedAt: input.at,
    ...(input.exit ? { exit: input.exit } : input.existing?.exit ? { exit: input.existing.exit } : {}),
    ...(input.error ? { error: input.error } : input.existing?.error ? { error: input.existing.error } : {}),
  };
}

function deriveAttachmentStatus(
  session: ResearchSessionRecord,
): "bound" | "released" | "unknown" {
  if (session.status === "running") {
    return "bound";
  }

  if (
    session.status === "awaiting_resume" ||
    session.status === "halted" ||
    session.status === "goal_achieved" ||
    session.status === "failed"
  ) {
    return "released";
  }

  return "unknown";
}

function dedupePaths(paths: string[]): string[] {
  return [...new Set(paths.filter((path) => path.length > 0))];
}

function normalizePersistedCodexSessionId(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Codex session id must not be blank");
  }

  return normalized;
}

function refreshSessionLifecycleTimestamp(
  session: ResearchSessionRecord,
  at: string,
): ResearchSessionRecord {
  if (!shouldRefreshSessionTimestamp(session.updatedAt, at)) {
    return session;
  }

  return {
    ...session,
    updatedAt: at,
  };
}

function shouldRefreshSessionTimestamp(current: string, next: string): boolean {
  const currentTimestamp = Date.parse(current);
  const nextTimestamp = Date.parse(next);
  if (Number.isNaN(nextTimestamp)) {
    return false;
  }

  if (Number.isNaN(currentTimestamp)) {
    return true;
  }

  return nextTimestamp > currentTimestamp;
}

function toStepResult(
  step: ResearchSessionOrchestratorStep,
  session: ResearchSessionRecord,
  cycle: Partial<ResearchSessionCycleView> = {},
): ResearchSessionOrchestratorStepResult {
  const fallbackFrontierIds =
    cycle.latestFrontierIds ??
    cycle.runResult?.runResult?.frontier.map((entry) => entry.frontierId) ??
    session.progress.latestFrontierIds;
  return {
    step,
    session,
    cycle: {
      completedCycles: session.progress.completedCycles,
      nextCycle: session.progress.nextCycle,
      latestFrontierIds: fallbackFrontierIds,
      ...(session.progress.latestRunId ? { latestRunId: session.progress.latestRunId } : {}),
      ...(session.progress.latestDecisionId ? { latestDecisionId: session.progress.latestDecisionId } : {}),
      ...(session.progress.lastSignals ? { lastSignals: session.progress.lastSignals } : {}),
      ...(cycle.sessionResolution ? { sessionResolution: cycle.sessionResolution } : {}),
      ...(cycle.run ? { run: cycle.run } : {}),
      ...(cycle.decision !== undefined ? { decision: cycle.decision } : {}),
      ...(cycle.runResult ? { runResult: cycle.runResult } : {}),
    },
  };
}

function createProgressSignal(input: {
  previousSession: ResearchSessionRecord;
  run: RunRecord;
  decision: DecisionRecord | null;
  frontierIds: string[];
}): Omit<ResearchSessionProgressSignal, "cycle"> {
  const changedPaths = input.run.proposal.changedPaths ?? [];
  const changedFileCount = input.run.proposal.filesChanged ?? changedPaths.length;
  const diffLineCount = input.run.proposal.diffLines ?? 0;
  const newArtifacts = input.run.artifacts.map((artifact) => artifact.path);
  const frontierChanged = !sameStringList(input.frontierIds, input.previousSession.progress.latestFrontierIds);
  const repeatedDiff = isRepeatedDiff(input.previousSession, changedFileCount, diffLineCount);
  const meaningfulProgress =
    changedFileCount > 0 ||
    diffLineCount > 0 ||
    newArtifacts.length > 0 ||
    frontierChanged ||
    input.decision?.frontierChanged === true;
  const insufficientEvidence = !meaningfulProgress;

  return {
    outcome: mapRunStatusToCycleOutcome(input.run.status),
    changedFileCount,
    diffLineCount,
    repeatedDiff,
    newArtifacts,
    meaningfulProgress,
    insufficientEvidence,
    agentTieBreakerUsed: false,
    ...(input.decision?.delta !== undefined ? { verificationDelta: input.decision.delta } : {}),
    reasons: summarizeProgressReasons({
      changedFileCount,
      diffLineCount,
      newArtifacts,
      frontierChanged,
      outcome: input.run.status,
      insufficientEvidence,
    }),
  };
}

function mapRunStatusToCycleOutcome(runStatus: RunRecord["status"]): ResearchSessionProgressSignal["outcome"] {
  if (runStatus === "running" || runStatus === "evaluated") {
    return "failed";
  }

  return runStatus;
}

function isRepeatedDiff(
  previousSession: ResearchSessionRecord,
  changedFileCount: number,
  diffLineCount: number,
): boolean {
  const priorSignals = previousSession.progress.lastSignals;
  if (!priorSignals) {
    return false;
  }

  if (priorSignals.changedFileCount !== changedFileCount || priorSignals.diffLineCount !== diffLineCount) {
    return false;
  }

  return changedFileCount > 0 || diffLineCount > 0;
}

function summarizeProgressReasons(input: {
  changedFileCount: number;
  diffLineCount: number;
  newArtifacts: string[];
  frontierChanged: boolean;
  outcome: RunRecord["status"];
  insufficientEvidence: boolean;
}): string[] {
  if (input.insufficientEvidence) {
    return ["The cycle did not leave enough durable file or frontier evidence to count as progress."];
  }

  const reasons: string[] = [];
  if (input.changedFileCount > 0) {
    reasons.push(`Changed ${input.changedFileCount} tracked file${input.changedFileCount === 1 ? "" : "s"}.`);
  }
  if (input.diffLineCount > 0) {
    reasons.push(`Recorded ${input.diffLineCount} diff line${input.diffLineCount === 1 ? "" : "s"}.`);
  }
  if (input.newArtifacts.length > 0) {
    reasons.push(`Produced ${input.newArtifacts.length} verification artifact${input.newArtifacts.length === 1 ? "" : "s"}.`);
  }
  if (input.frontierChanged) {
    reasons.push("Updated the persisted frontier checkpoint.");
  }
  if (reasons.length === 0) {
    reasons.push(`Cycle finished with ${input.outcome} status.`);
  }
  return reasons;
}

function buildCodexCliCycleSessionContext(
  researchSessionId: string,
  sessionResolution: CodexCliSessionReuseOrReplaceDecision,
): CodexCliCycleSessionContext {
  const existingCodexSessionId =
    sessionResolution.decision === "reuse"
      ? sessionResolution.codexSessionReference.codexSessionId
      : sessionResolution.replace.attachabilityMode === "resume"
        ? sessionResolution.codexSessionReference?.codexSessionId
          ?? sessionResolution.lifecycle?.identity.codexSessionId
        : undefined;

  return {
    researchSessionId,
    ...(existingCodexSessionId ? { existingCodexSessionId } : {}),
  };
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}
