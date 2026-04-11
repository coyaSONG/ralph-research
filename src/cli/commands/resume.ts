import { realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { Command } from "commander";

import { JsonFileResearchSessionRepository } from "../../adapters/fs/json-file-research-session-repository.js";
import { DEFAULT_STORAGE_ROOT } from "../../core/manifest/defaults.js";
import {
  RESUMABLE_RESEARCH_SESSION_STATUSES,
  type ResearchSessionMetadata,
  type ResearchSessionRecord,
} from "../../core/model/research-session.js";
import type { ResearchSessionRepository } from "../../core/ports/research-session-repository.js";
import { ResearchSessionInteractiveService } from "../../app/services/research-session-interactive-service.js";
import type { CommandIO } from "./run.js";

export interface ResumeCommandOptions {
  repoRoot?: string;
  json?: boolean;
}

export interface ResumeCommandDependencies {
  interactiveSessionService?: Pick<ResearchSessionInteractiveService, "continueSession">;
  createRepository?: (sessionsRoot: string) => Pick<
    ResearchSessionRepository,
    "loadSession" | "loadSessionMetadata" | "querySessions" | "querySessionMetadata"
  >;
}

const defaultCommandIO: CommandIO = {
  stdout: (message) => {
    process.stdout.write(`${message}\n`);
  },
  stderr: (message) => {
    process.stderr.write(`${message}\n`);
  },
};

export async function runResumeCommand(
  sessionIdentity: string,
  options: ResumeCommandOptions = {},
  io: CommandIO = defaultCommandIO,
  dependencies: ResumeCommandDependencies = {},
): Promise<number> {
  try {
    const repoRoot = await resolveCanonicalRepoRoot(options.repoRoot ?? process.cwd());
    const createRepository =
      dependencies.createRepository ??
      ((sessionsRoot: string) => new JsonFileResearchSessionRepository(sessionsRoot));
    const resolvedSessionId = await resolveSessionIdentity(sessionIdentity, repoRoot, createRepository);
    const interactiveSessionService =
      dependencies.interactiveSessionService ?? new ResearchSessionInteractiveService();
    const result = await interactiveSessionService.continueSession({
      repoRoot,
      sessionId: resolvedSessionId,
    });

    if (options.json) {
      io.stdout(JSON.stringify(result, null, 2));
    } else {
      io.stdout(`Session: ${result.sessionId}`);
      io.stdout(`Lifecycle evidence: ${result.lifecyclePath}`);
      if (result.finalized.step === "session_interrupted") {
        io.stdout("Session ended before a completed cycle checkpoint and is awaiting resume.");
      } else {
        io.stdout("Session failed before reaching a completed cycle checkpoint.");
      }
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resume research session";
    if (options.json) {
      io.stderr(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      io.stderr(message);
    }
    return 1;
  }
}

async function resolveCanonicalRepoRoot(repoRoot: string): Promise<string> {
  const resolvedRoot = resolve(repoRoot);
  const repoStats = await stat(resolvedRoot).catch(() => null);
  if (!repoStats?.isDirectory()) {
    throw new Error(`Working directory is not a directory: ${resolvedRoot}`);
  }

  return realpath(resolvedRoot);
}

async function resolveSessionIdentity(
  sessionIdentity: string,
  repoRoot: string,
  createRepository: NonNullable<ResumeCommandDependencies["createRepository"]>,
): Promise<string> {
  const normalizedIdentity = sessionIdentity.trim();
  if (!normalizedIdentity) {
    throw new Error("Session identity is required");
  }

  const repository = createRepository(join(repoRoot, DEFAULT_STORAGE_ROOT, "sessions"));
  if (normalizedIdentity === "latest") {
    return resolveLatestSessionId(repository, repoRoot);
  }

  const exact =
    (await repository.loadSessionMetadata?.(normalizedIdentity)) ?? (await repository.loadSession(normalizedIdentity));
  if (exact) {
    return exact.sessionId;
  }

  const sessions = await queryResumableSessionMetadata(repository, repoRoot);
  const prefixMatches = sessions.filter((session) => session.sessionId.startsWith(normalizedIdentity));

  if (prefixMatches.length === 1) {
    return prefixMatches[0]?.sessionId ?? normalizedIdentity;
  }

  if (prefixMatches.length > 1) {
    const matchingIds = prefixMatches.map((session) => session.sessionId).join(", ");
    throw new Error(`Session identity "${normalizedIdentity}" is ambiguous: ${matchingIds}`);
  }

  throw new Error(`Session not found: ${normalizedIdentity}`);
}

async function resolveLatestSessionId(
  repository: Pick<ResearchSessionRepository, "querySessions" | "querySessionMetadata">,
  repoRoot: string,
): Promise<string> {
  const sessions = await queryResumableSessionMetadata(repository, repoRoot);
  const latest = [...sessions].sort(compareSessionsByUpdatedAtDesc)[0];
  if (!latest) {
    throw new Error(`No resumable research sessions found in ${repoRoot}`);
  }

  return latest.sessionId;
}

async function queryResumableSessionMetadata(
  repository: Pick<ResearchSessionRepository, "querySessions" | "querySessionMetadata">,
  repoRoot: string,
): Promise<Array<Pick<ResearchSessionMetadata, "sessionId" | "updatedAt">>> {
  if (repository.querySessionMetadata) {
    return repository.querySessionMetadata({
      workingDirectory: repoRoot,
      statuses: [...RESUMABLE_RESEARCH_SESSION_STATUSES],
    });
  }

  const sessions = await repository.querySessions({
    workingDirectory: repoRoot,
    statuses: [...RESUMABLE_RESEARCH_SESSION_STATUSES],
  });

  return sessions.map((session) => ({
    sessionId: session.sessionId,
    updatedAt: session.updatedAt,
  }));
}

function compareSessionsByUpdatedAtDesc(
  left: Pick<ResearchSessionRecord, "sessionId" | "updatedAt">,
  right: Pick<ResearchSessionRecord, "sessionId" | "updatedAt">,
): number {
  const updatedAtDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (updatedAtDelta !== 0) {
    return updatedAtDelta;
  }

  return right.sessionId.localeCompare(left.sessionId);
}

export function registerResumeCommand(
  program: Command,
  executeResumeCommand: typeof runResumeCommand = runResumeCommand,
): void {
  program
    .command("resume")
    .description("Resume a persisted TUI research session from its last completed cycle checkpoint.")
    .argument("<sessionId>", "Persisted research session identifier")
    .option("--json", "Emit machine-readable output instead of terminal-oriented status lines", false)
    .action(async (sessionId: string, options: ResumeCommandOptions) => {
      const exitCode = await executeResumeCommand(sessionId, {
        ...options,
        repoRoot: process.cwd(),
      });
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}
