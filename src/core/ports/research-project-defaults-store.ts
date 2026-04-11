import type { ResearchProjectDefaultsRecord } from "../model/research-project-defaults.js";

export interface ResearchProjectDefaultsStore {
  save(record: ResearchProjectDefaultsRecord): Promise<void>;
  load(): Promise<ResearchProjectDefaultsRecord | null>;
}
