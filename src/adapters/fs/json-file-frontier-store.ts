import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { frontierEntrySchema, type FrontierEntry } from "../../core/model/frontier-entry.js";
import type { FrontierStore } from "../../core/ports/frontier-store.js";
import { isMissingFileError } from "../../shared/fs-errors.js";

const frontierSnapshotSchema = frontierEntrySchema.array();

export class JsonFileFrontierStore implements FrontierStore {
  private readonly path: string;

  public constructor(path: string) {
    this.path = resolve(path);
  }

  public async save(entries: FrontierEntry[]): Promise<void> {
    const parsed = frontierSnapshotSchema.parse(entries);
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  }

  public async load(): Promise<FrontierEntry[]> {
    try {
      const raw = await readFile(this.path, "utf8");
      return frontierSnapshotSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }
  }
}

