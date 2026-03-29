import type { DecisionRecord } from "../model/decision-record.js";

export interface DecisionStore {
  put(record: DecisionRecord): Promise<void>;
  get(decisionId: string): Promise<DecisionRecord | null>;
  list(): Promise<DecisionRecord[]>;
}
