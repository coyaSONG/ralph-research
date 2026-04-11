import type { CodexCliSessionLifecycleRecord } from "../model/codex-cli-session-lifecycle.js";
import type {
  ResearchSessionMetadata,
  ResearchSessionRecord,
  ResearchSessionStatus,
} from "../model/research-session.js";

export interface ResearchSessionQuery {
  workingDirectory?: string;
  statuses?: ResearchSessionStatus[];
  limit?: number;
}

export interface PersistedCodexSessionReference {
  codexSessionId: string;
  lifecyclePath: string;
}

export interface PersistedResearchSessionBundle {
  session: ResearchSessionRecord;
  lifecycle: CodexCliSessionLifecycleRecord | null;
  codexSessionReference: PersistedCodexSessionReference | null;
}

export interface ResearchSessionRepository {
  saveSession(record: ResearchSessionRecord): Promise<void>;
  loadSession(sessionId: string): Promise<ResearchSessionRecord | null>;
  loadSessionMetadata?(sessionId: string): Promise<ResearchSessionMetadata | null>;
  loadPersistedSession?(sessionId: string): Promise<PersistedResearchSessionBundle | null>;
  querySessionMetadata?(query?: ResearchSessionQuery): Promise<ResearchSessionMetadata[]>;
  querySessions(query?: ResearchSessionQuery): Promise<ResearchSessionRecord[]>;
}
