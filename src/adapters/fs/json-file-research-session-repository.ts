import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  parseCodexCliSessionLifecycleRecord,
  type CodexCliSessionLifecycleRecord,
} from "../../core/model/codex-cli-session-lifecycle.js";
import {
  parsePersistedResearchSessionMetadata,
  researchSessionRecordSchema,
  type ResearchSessionMetadata,
  type ResearchSessionRecord,
} from "../../core/model/research-session.js";
import type {
  PersistedResearchSessionBundle,
  ResearchSessionQuery,
  ResearchSessionRepository,
} from "../../core/ports/research-session-repository.js";
import { isMissingFileError } from "../../shared/fs-errors.js";

export class JsonFileResearchSessionRepository implements ResearchSessionRepository {
  private readonly sessionsRoot: string;

  public constructor(sessionsRoot: string) {
    this.sessionsRoot = resolve(sessionsRoot);
  }

  public async saveSession(record: ResearchSessionRecord): Promise<void> {
    const parsed = researchSessionRecordSchema.parse(record);
    const path = this.getPath(parsed.sessionId);
    const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await rename(tempPath, path);
  }

  public async loadSession(sessionId: string): Promise<ResearchSessionRecord | null> {
    return this.readSessionRecord(sessionId);
  }

  public async loadSessionMetadata(sessionId: string): Promise<ResearchSessionMetadata | null> {
    return this.readSessionMetadata(sessionId);
  }

  public async loadPersistedSession(sessionId: string): Promise<PersistedResearchSessionBundle | null> {
    const session = await this.readSessionRecord(sessionId);
    if (!session) {
      return null;
    }

    const lifecyclePath = this.getLifecyclePath(sessionId);
    const lifecycle = await this.readLifecycleRecord(sessionId);

    return {
      session,
      lifecycle,
      codexSessionReference: lifecycle
        ? {
            codexSessionId: lifecycle.identity.codexSessionId,
            lifecyclePath,
          }
        : null,
    };
  }

  public async querySessions(query: ResearchSessionQuery = {}): Promise<ResearchSessionRecord[]> {
    const records = await this.loadAllSessions();
    const filtered = records.filter((record) => {
      if (query.workingDirectory && record.workingDirectory !== query.workingDirectory) {
        return false;
      }

      if (query.statuses && !query.statuses.includes(record.status)) {
        return false;
      }

      return true;
    });

    if (query.limit === undefined) {
      return filtered;
    }

    return filtered.slice(0, query.limit);
  }

  public async querySessionMetadata(query: ResearchSessionQuery = {}): Promise<ResearchSessionMetadata[]> {
    const records = await this.loadAllSessionMetadata();
    const filtered = records.filter((record) => {
      if (query.workingDirectory && record.workingDirectory !== query.workingDirectory) {
        return false;
      }

      if (query.statuses && !query.statuses.includes(record.status)) {
        return false;
      }

      return true;
    });

    if (query.limit === undefined) {
      return filtered;
    }

    return filtered.slice(0, query.limit);
  }

  private async loadAllSessions(): Promise<ResearchSessionRecord[]> {
    const directories = await this.listSessionDirectories();

    const records: ResearchSessionRecord[] = [];
    for (const directoryName of directories) {
      const record = await this.readSessionRecord(directoryName);
      if (!record) {
        continue;
      }
      this.assertDirectoryMatchesSession(record, directoryName);
      records.push(record);
    }

    return records.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  }

  private async loadAllSessionMetadata(): Promise<ResearchSessionMetadata[]> {
    const directories = await this.listSessionDirectories();

    const records: ResearchSessionMetadata[] = [];
    for (const directoryName of directories) {
      const record = await this.readSessionMetadata(directoryName);
      if (!record) {
        continue;
      }
      this.assertDirectoryMatchesSession(record, directoryName);
      records.push(record);
    }

    return records.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  }

  private async listSessionDirectories(): Promise<string[]> {
    try {
      const entries = await readdir(this.getSessionsRoot(), { withFileTypes: true });
      const directories: string[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const path = join(this.getSessionsRoot(), entry.name, "session.json");
        const fileStats = await stat(path).catch((error: unknown) => {
          if (isMissingFileError(error)) {
            return null;
          }
          throw error;
        });
        if (!fileStats?.isFile()) {
          continue;
        }
        directories.push(entry.name);
      }

      return directories.sort((left, right) => left.localeCompare(right));
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }
  }

  private getPath(sessionId: string): string {
    return join(this.getSessionsRoot(), sessionId, "session.json");
  }

  private getLifecyclePath(sessionId: string): string {
    return join(this.getSessionsRoot(), sessionId, "codex-session.json");
  }

  private getSessionsRoot(): string {
    return this.sessionsRoot;
  }

  private async readSessionRecord(sessionId: string): Promise<ResearchSessionRecord | null> {
    const path = this.getPath(sessionId);
    try {
      const raw = await readFile(path, "utf8");
      const record = researchSessionRecordSchema.parse(JSON.parse(raw));
      this.assertDirectoryMatchesSession(record, sessionId);
      return record;
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async readSessionMetadata(sessionId: string): Promise<ResearchSessionMetadata | null> {
    const path = this.getPath(sessionId);
    try {
      const raw = await readFile(path, "utf8");
      const record = parsePersistedResearchSessionMetadata(JSON.parse(raw));
      this.assertDirectoryMatchesSession(record, sessionId);
      return record;
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async readLifecycleRecord(sessionId: string): Promise<CodexCliSessionLifecycleRecord | null> {
    const path = this.getLifecyclePath(sessionId);
    try {
      const raw = await readFile(path, "utf8");
      const record = parseCodexCliSessionLifecycleRecord(raw);
      this.assertLifecycleMatchesSession(record, sessionId);
      return record;
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }

  private assertDirectoryMatchesSession(
    record: Pick<ResearchSessionRecord, "sessionId"> | Pick<ResearchSessionMetadata, "sessionId">,
    directoryName: string,
  ): void {
    if (record.sessionId !== directoryName) {
      throw new Error(
        `Research session directory name "${directoryName}" must match record sessionId "${record.sessionId}"`,
      );
    }
  }

  private assertLifecycleMatchesSession(
    record: CodexCliSessionLifecycleRecord,
    directoryName: string,
  ): void {
    if (record.sessionId !== directoryName) {
      throw new Error(
        `Research session directory name "${directoryName}" must match lifecycle sessionId "${record.sessionId}"`,
      );
    }
  }
}
