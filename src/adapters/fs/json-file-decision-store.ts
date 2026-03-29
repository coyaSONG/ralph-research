import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { decisionRecordSchema, type DecisionRecord } from "../../core/model/decision-record.js";
import type { DecisionStore } from "../../core/ports/decision-store.js";
import { isMissingFileError } from "../../shared/fs-errors.js";

export class JsonFileDecisionStore implements DecisionStore {
  private readonly rootDir: string;

  public constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  public async put(record: DecisionRecord): Promise<void> {
    const parsed = decisionRecordSchema.parse(record);
    const path = this.getPath(parsed.decisionId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  }

  public async get(decisionId: string): Promise<DecisionRecord | null> {
    const path = this.getPath(decisionId);
    try {
      const raw = await readFile(path, "utf8");
      return decisionRecordSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }

  public async list(): Promise<DecisionRecord[]> {
    try {
      const entries = await readdir(this.rootDir, { withFileTypes: true });
      const records: DecisionRecord[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
          continue;
        }
        const raw = await readFile(join(this.rootDir, entry.name), "utf8");
        records.push(decisionRecordSchema.parse(JSON.parse(raw)));
      }
      return records.sort((left, right) => left.decisionId.localeCompare(right.decisionId));
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }
  }

  private getPath(decisionId: string): string {
    return join(this.rootDir, `${decisionId}.json`);
  }
}

