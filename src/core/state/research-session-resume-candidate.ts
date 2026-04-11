import type {
  ResearchSessionMetadata,
  ResearchSessionRecord,
} from "../model/research-session.js";

type ResumeCandidateSession = ResearchSessionRecord | ResearchSessionMetadata;

export interface SelectResearchSessionResumeCandidateInput<TSession extends ResumeCandidateSession> {
  goal: string;
  sessions: readonly TSession[];
}

export function selectResearchSessionResumeCandidate<TSession extends ResumeCandidateSession>(
  input: SelectResearchSessionResumeCandidateInput<TSession>,
): TSession | undefined {
  const normalizedGoal = normalizeGoal(input.goal);
  const goalMatches = input.sessions.filter((session) => normalizeGoal(session.goal) === normalizedGoal);
  const candidatePool = goalMatches.length > 0 ? goalMatches : input.sessions;

  return [...candidatePool].sort(compareResumeCandidates)[0];
}

function compareResumeCandidates(left: ResumeCandidateSession, right: ResumeCandidateSession): number {
  const statusPriorityDelta = getStatusPriority(right) - getStatusPriority(left);
  if (statusPriorityDelta !== 0) {
    return statusPriorityDelta;
  }

  const completedCyclesDelta = getCompletedCycles(right) - getCompletedCycles(left);
  if (completedCyclesDelta !== 0) {
    return completedCyclesDelta;
  }

  const checkpointDelta = parseTimestamp(getLastCheckpointAt(right)) - parseTimestamp(getLastCheckpointAt(left));
  if (checkpointDelta !== 0) {
    return checkpointDelta;
  }

  const updatedAtDelta = parseTimestamp(right.updatedAt) - parseTimestamp(left.updatedAt);
  if (updatedAtDelta !== 0) {
    return updatedAtDelta;
  }

  const createdAtDelta = parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt);
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return right.sessionId.localeCompare(left.sessionId);
}

function getStatusPriority(session: ResumeCandidateSession): number {
  switch (session.status) {
    case "halted":
      return 1;
    case "running":
      return 0;
    default:
      return -1;
  }
}

function normalizeGoal(goal: string): string {
  return goal.trim();
}

function getCompletedCycles(session: ResumeCandidateSession): number {
  if ("progress" in session) {
    return session.progress.completedCycles;
  }

  return session.completedCycles;
}

function getLastCheckpointAt(session: ResumeCandidateSession): string | undefined {
  if ("progress" in session) {
    return session.progress.lastCheckpointAt;
  }

  return session.lastCheckpointAt;
}

function parseTimestamp(value: string | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}
