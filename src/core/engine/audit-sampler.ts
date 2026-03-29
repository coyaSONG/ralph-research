import type { JudgePack } from "../manifest/schema.js";

export interface AuditCandidate {
  runId: string;
  decisionId?: string;
  outcome: "accepted" | "rejected" | "needs_human";
  metricId: string;
  reason: string;
}

export interface AuditQueueItem extends AuditCandidate {
  auditId: string;
  sampledAt: string;
  sampleRate: number;
  trigger: "sample_rate";
}

export function shouldSampleAudit(candidate: Pick<AuditCandidate, "runId" | "outcome">, sampleRate: number): boolean {
  if (sampleRate <= 0 || candidate.outcome === "needs_human") {
    return false;
  }

  return stableFraction(`${candidate.runId}:${candidate.outcome}`) < sampleRate;
}

export function sampleAuditQueue(
  candidates: AuditCandidate[],
  pack: Pick<JudgePack, "audit">,
  sampledAt = new Date().toISOString(),
): AuditQueueItem[] {
  return candidates
    .filter((candidate) => shouldSampleAudit(candidate, pack.audit.sampleRate))
    .map((candidate) => ({
      ...candidate,
      auditId: `audit-${candidate.runId}`,
      sampledAt,
      sampleRate: pack.audit.sampleRate,
      trigger: "sample_rate",
    }));
}

function stableFraction(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash / 0x1_0000_0000;
}
