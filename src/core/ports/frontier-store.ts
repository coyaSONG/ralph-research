import type { FrontierEntry } from "../model/frontier-entry.js";

export interface FrontierStore {
  save(entries: FrontierEntry[]): Promise<void>;
  load(): Promise<FrontierEntry[]>;
}
