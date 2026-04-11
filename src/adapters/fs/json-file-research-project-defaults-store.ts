import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  researchProjectDefaultsRecordSchema,
  type ResearchProjectDefaultsRecord,
} from "../../core/model/research-project-defaults.js";
import type { ResearchProjectDefaultsStore } from "../../core/ports/research-project-defaults-store.js";
import { isMissingFileError } from "../../shared/fs-errors.js";

export class JsonFileResearchProjectDefaultsStore implements ResearchProjectDefaultsStore {
  private readonly filePath: string;

  public constructor(filePath: string) {
    this.filePath = resolve(filePath);
  }

  public async save(record: ResearchProjectDefaultsRecord): Promise<void> {
    const parsed = researchProjectDefaultsRecordSchema.parse(record);
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }

  public async load(): Promise<ResearchProjectDefaultsRecord | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return researchProjectDefaultsRecordSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }
}
