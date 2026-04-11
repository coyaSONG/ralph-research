import {
  buildResearchSessionTuiSelectedCandidateSummary,
  type ResearchSessionTuiSelectedCandidateSummary,
} from "../../core/model/research-session.js";
import type { PersistedResearchSessionBundle } from "../../core/ports/research-session-repository.js";
import type { ResearchSessionRecoveryInspection } from "./research-session-recovery-service.js";

export interface ResumableResearchSessionStartupCandidate {
  sessionId: string;
  persistedState: PersistedResearchSessionBundle;
}

export interface ResearchSessionEntryFlowSummaryPayload {
  selectedCandidateSummary: ResearchSessionTuiSelectedCandidateSummary;
  resumableSession?: ResumableResearchSessionStartupCandidate;
}

export function mapDetectedResearchSessionToEntryFlowSummary(
  inspection: ResearchSessionRecoveryInspection,
): ResearchSessionEntryFlowSummaryPayload {
  if (inspection.session.status !== "running" && inspection.session.status !== "halted") {
    throw new Error(
      `Entry-flow summary only supports detected running or halted sessions; received ${inspection.session.status}`,
    );
  }

  const selectedCandidateSummary = buildResearchSessionTuiSelectedCandidateSummary(
    inspection.session,
    {
      recovery: {
        classification: inspection.recovery.classification,
        resumeAllowed: inspection.recovery.resumeAllowed,
        reason: inspection.recovery.reason,
        runtimeState: inspection.recovery.runtime.state,
        ...(inspection.recovery.runtime.phase
          ? { codexPhase: inspection.recovery.runtime.phase }
          : {}),
      },
    },
  );

  return {
    selectedCandidateSummary,
    ...(inspection.recovery.resumeAllowed
      ? {
          resumableSession: {
            sessionId: inspection.session.sessionId,
            persistedState: {
              session: inspection.session,
              lifecycle: inspection.lifecycle,
              codexSessionReference: inspection.codexSessionReference,
            },
          },
        }
      : {}),
  };
}
