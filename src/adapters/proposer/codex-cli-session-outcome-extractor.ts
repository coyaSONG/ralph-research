import type { CodexCliSessionTranscript } from "./codex-cli-session-driver.js";
import {
  CODEX_CLI_SESSION_OUTCOME_BEGIN_MARKER,
  CODEX_CLI_SESSION_OUTCOME_END_MARKER,
  codexCliAgentTerminalOutcomeSchema,
  type CodexCliSessionOutcome,
} from "../../core/model/codex-cli-session-outcome.js";

export function extractCodexCliSessionOutcome(
  transcript: CodexCliSessionTranscript,
): CodexCliSessionOutcome {
  const exit = transcript.exit ?? {
    code: null,
    signal: null,
  };

  if (!transcript.exit || !transcript.endedAt) {
    return {
      type: "terminal_runtime_error",
      reasonCode: "transcript_not_finalized",
      summary: "Codex CLI transcript is not finalized at a completed cycle boundary.",
      exit,
    };
  }

  if (transcript.exit.signal) {
    return {
      type: "terminal_runtime_error",
      reasonCode: "process_exit_signaled",
      summary: `Codex CLI session exited from signal ${transcript.exit.signal}.`,
      exit,
    };
  }

  if (transcript.exit.code !== 0) {
    return {
      type: "terminal_runtime_error",
      reasonCode: "process_exit_non_zero",
      summary: `Codex CLI session exited with code ${transcript.exit.code}.`,
      exit,
    };
  }

  const output = transcript.entries
    .filter((entry) => entry.stream !== "stdin")
    .map((entry) => entry.text)
    .join("");

  const startMatches = findAllMarkers(output, CODEX_CLI_SESSION_OUTCOME_BEGIN_MARKER);
  const endMatches = findAllMarkers(output, CODEX_CLI_SESSION_OUTCOME_END_MARKER);
  const startMarker = startMatches[0];
  const endMarker = endMatches[0];

  if (startMatches.length === 0 && endMatches.length === 0) {
    return {
      type: "terminal_runtime_error",
      reasonCode: "missing_terminal_outcome",
      summary: "Codex CLI transcript did not emit a terminal outcome marker.",
      exit,
    };
  }

  if (
    startMatches.length !== 1 ||
    endMatches.length !== 1 ||
    startMarker === undefined ||
    endMarker === undefined ||
    endMarker < startMarker
  ) {
    return {
      type: "terminal_runtime_error",
      reasonCode:
        startMatches.length === endMatches.length &&
          startMatches.length > 1
          ? "duplicate_terminal_outcomes"
          : "partial_terminal_outcome",
      summary: "Codex CLI transcript must contain exactly one complete terminal outcome block.",
      exit,
    };
  }

  const payload = output
    .slice(startMarker + CODEX_CLI_SESSION_OUTCOME_BEGIN_MARKER.length, endMarker)
    .trim();

  if (!payload) {
    return {
      type: "terminal_runtime_error",
      reasonCode: "invalid_terminal_outcome",
      summary: "Codex CLI terminal outcome block was empty.",
      exit,
    };
  }

  try {
    return codexCliAgentTerminalOutcomeSchema.parse(JSON.parse(payload));
  } catch {
    return {
      type: "terminal_runtime_error",
      reasonCode: "invalid_terminal_outcome",
      summary: "Codex CLI terminal outcome block was not valid session outcome JSON.",
      exit,
    };
  }
}

function findAllMarkers(haystack: string, marker: string): number[] {
  const positions: number[] = [];
  let index = haystack.indexOf(marker);
  while (index !== -1) {
    positions.push(index);
    index = haystack.indexOf(marker, index + marker.length);
  }
  return positions;
}
