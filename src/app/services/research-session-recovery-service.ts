import { readFile, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { JsonFileResearchSessionRepository } from "../../adapters/fs/json-file-research-session-repository.js";
import { DEFAULT_STORAGE_ROOT } from "../../core/manifest/defaults.js";
import {
  parseCodexCliSessionLifecycleRecord,
  type CodexCliSessionLifecycleRecord,
} from "../../core/model/codex-cli-session-lifecycle.js";
import type { ResearchSessionRecord } from "../../core/model/research-session.js";
import type {
  PersistedCodexSessionReference,
  PersistedResearchSessionBundle,
  ResearchSessionRepository,
} from "../../core/ports/research-session-repository.js";
import {
  classifyResearchSessionRecovery,
  type ResearchSessionRecoveryStatus,
} from "../../core/state/research-session-recovery-classifier.js";
import { isMissingFileError } from "../../shared/fs-errors.js";

export type { ResearchSessionRecoveryStatus } from "../../core/state/research-session-recovery-classifier.js";

export interface ResearchSessionRecoveryServiceDependencies {
  createRepository?: (sessionsRoot: string) => ResearchSessionRepository;
  isProcessAlive?: (pid: number) => boolean;
}

export interface ResearchSessionRecoveryInput {
  repoRoot: string;
  sessionId: string;
}

export interface ResearchSessionRecoveryInspection {
  session: ResearchSessionRecord;
  lifecycle: CodexCliSessionLifecycleRecord | null;
  codexSessionReference: PersistedCodexSessionReference | null;
  recovery: ResearchSessionRecoveryStatus;
}

export class ResearchSessionRecoveryService {
  private readonly createRepository: (sessionsRoot: string) => ResearchSessionRepository;
  private readonly isProcessAliveFn: (pid: number) => boolean;

  public constructor(dependencies: ResearchSessionRecoveryServiceDependencies = {}) {
    this.createRepository =
      dependencies.createRepository ??
      ((sessionsRoot) => new JsonFileResearchSessionRepository(sessionsRoot));
    this.isProcessAliveFn = dependencies.isProcessAlive ?? isProcessAlive;
  }

  public async classifySession(
    input: ResearchSessionRecoveryInput,
  ): Promise<ResearchSessionRecoveryStatus> {
    const inspection = await this.inspectSession(input);
    return inspection.recovery;
  }

  public async inspectSession(
    input: ResearchSessionRecoveryInput,
  ): Promise<ResearchSessionRecoveryInspection> {
    const { canonicalRepoRoot, repository } = await this.resolveRepository(input.repoRoot);
    const persisted = await this.loadPersistedSession(repository, canonicalRepoRoot, input.sessionId);
    const { session, lifecycle } = persisted;
    const processAlive = lifecycle?.pid !== undefined ? this.isProcessAliveFn(lifecycle.pid) : false;

    return {
      session,
      lifecycle,
      codexSessionReference: persisted.codexSessionReference,
      recovery: classifyResearchSessionRecovery({
        session,
        lifecycle,
        processAlive,
      }),
    };
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
    const sessionsRoot = join(canonicalRepoRoot, DEFAULT_STORAGE_ROOT, "sessions");

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

  private async loadPersistedSession(
    repository: ResearchSessionRepository,
    repoRoot: string,
    sessionId: string,
  ): Promise<PersistedResearchSessionBundle> {
    if (repository.loadPersistedSession) {
      const persisted = await repository.loadPersistedSession(sessionId);
      if (!persisted) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      return persisted;
    }

    const session = await this.loadSessionOrThrow(repository, sessionId);
    const lifecycle = await this.loadLifecycle(repoRoot, session.sessionId);

    return {
      session,
      lifecycle,
      codexSessionReference: lifecycle
        ? {
            codexSessionId: lifecycle.identity.codexSessionId,
            lifecyclePath: join(repoRoot, DEFAULT_STORAGE_ROOT, "sessions", session.sessionId, "codex-session.json"),
          }
        : null,
    };
  }

  private async loadLifecycle(
    repoRoot: string,
    sessionId: string,
  ): Promise<CodexCliSessionLifecycleRecord | null> {
    const lifecyclePath = join(repoRoot, DEFAULT_STORAGE_ROOT, "sessions", sessionId, "codex-session.json");

    try {
      const raw = await readFile(lifecyclePath, "utf8");
      return parseCodexCliSessionLifecycleRecord(raw);
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH") {
        return false;
      }
      if (code === "EPERM") {
        return true;
      }
    }
    return false;
  }
}
