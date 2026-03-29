import type { RunRecord } from "../model/run-record.js";

export interface RunStore {
  put(record: RunRecord): Promise<void>;
  get(runId: string): Promise<RunRecord | null>;
  list(): Promise<RunRecord[]>;
}
