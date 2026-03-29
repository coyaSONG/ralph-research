import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { runRecordSchema, type RunRecord } from "../../core/model/run-record.js";
import type { RunStore } from "../../core/ports/run-store.js";
import { isMissingFileError } from "../../shared/fs-errors.js";

export class JsonFileRunStore implements RunStore {
  private readonly rootDir: string;

  public constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  public async put(record: RunRecord): Promise<void> {
    const parsed = runRecordSchema.parse(record);
    const path = this.getPath(parsed.runId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  }

  public async get(runId: string): Promise<RunRecord | null> {
    const path = this.getPath(runId);
    try {
      const raw = await readFile(path, "utf8");
      return runRecordSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }

  public async list(): Promise<RunRecord[]> {
    try {
      const entries = await readdir(this.rootDir, { withFileTypes: true });
      const records: RunRecord[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
          continue;
        }
        const raw = await readFile(join(this.rootDir, entry.name), "utf8");
        records.push(runRecordSchema.parse(JSON.parse(raw)));
      }
      return records.sort((left, right) => left.runId.localeCompare(right.runId));
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }
  }

  private getPath(runId: string): string {
    return join(this.rootDir, `${runId}.json`);
  }
}

