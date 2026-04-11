import { describe, expect, it } from "vitest";

import { extractCodexCliSessionOutcome } from "../src/adapters/proposer/codex-cli-session-outcome-extractor.js";
import type { CodexCliSessionTranscript } from "../src/adapters/proposer/codex-cli-session-driver.js";
import {
  CODEX_CLI_SESSION_OUTCOME_BEGIN_MARKER,
  CODEX_CLI_SESSION_OUTCOME_END_MARKER,
} from "../src/core/model/codex-cli-session-outcome.js";

describe("extractCodexCliSessionOutcome", () => {
  it("extracts a single proposal result from the completed transcript", () => {
    const transcript = makeTranscript([
      {
        order: 1,
        stream: "stdout",
        text: "Planning cycle 3...\n",
      },
      {
        order: 2,
        stream: "stdout",
        text: `${CODEX_CLI_SESSION_OUTCOME_BEGIN_MARKER}\n`,
      },
      {
        order: 3,
        stream: "stdout",
        text: JSON.stringify({
          type: "proposal_result",
          reasonCode: "proposal_ready",
          summary: "Wrote the next holdout report and verifier output.",
          changedPaths: [
            "reports/holdout-top3.md",
            "src/verification/holdout.ts",
          ],
          verificationArtifactPaths: [
            "artifacts/holdout-top3.json",
          ],
        }),
      },
      {
        order: 4,
        stream: "stdout",
        text: `\n${CODEX_CLI_SESSION_OUTCOME_END_MARKER}\n`,
      },
    ]);

    expect(extractCodexCliSessionOutcome(transcript)).toEqual({
      type: "proposal_result",
      reasonCode: "proposal_ready",
      summary: "Wrote the next holdout report and verifier output.",
      changedPaths: [
        "reports/holdout-top3.md",
        "src/verification/holdout.ts",
      ],
      verificationArtifactPaths: [
        "artifacts/holdout-top3.json",
      ],
    });
  });

  it("extracts an explicit failure when the agent halts with a stable reason code", () => {
    const transcript = makeTranscript([
      {
        order: 1,
        stream: "stdout",
        text: [
          CODEX_CLI_SESSION_OUTCOME_BEGIN_MARKER,
          JSON.stringify({
            type: "explicit_failure",
            reasonCode: "insufficient_evidence",
            summary: "The verifier output did not prove the holdout target yet.",
            evidencePaths: [
              "artifacts/holdout-top3.json",
              "notes/verification-gap.md",
            ],
          }),
          CODEX_CLI_SESSION_OUTCOME_END_MARKER,
        ].join("\n"),
      },
    ]);

    expect(extractCodexCliSessionOutcome(transcript)).toEqual({
      type: "explicit_failure",
      reasonCode: "insufficient_evidence",
      summary: "The verifier output did not prove the holdout target yet.",
      evidencePaths: [
        "artifacts/holdout-top3.json",
        "notes/verification-gap.md",
      ],
    });
  });

  it("returns a terminal runtime error when the Codex process exits non-zero", () => {
    const transcript = makeTranscript(
      [
        {
          order: 1,
          stream: "stderr",
          text: "fatal: unexpected session crash\n",
        },
      ],
      {
        code: 17,
        signal: null,
      },
    );

    expect(extractCodexCliSessionOutcome(transcript)).toEqual({
      type: "terminal_runtime_error",
      reasonCode: "process_exit_non_zero",
      summary: "Codex CLI session exited with code 17.",
      exit: {
        code: 17,
        signal: null,
      },
    });
  });

  it("returns a terminal runtime error when the transcript is not finalized at a cycle boundary", () => {
    const transcript = {
      ...makeTranscript([
        {
          order: 1,
          stream: "stdout" as const,
          text: "Cycle still running...\n",
        },
      ]),
      endedAt: undefined,
      exit: undefined,
    };

    expect(extractCodexCliSessionOutcome(transcript)).toEqual({
      type: "terminal_runtime_error",
      reasonCode: "transcript_not_finalized",
      summary: "Codex CLI transcript is not finalized at a completed cycle boundary.",
      exit: {
        code: null,
        signal: null,
      },
    });
  });

  it("returns a terminal runtime error when the Codex process is terminated by signal", () => {
    const transcript = makeTranscript(
      [
        {
          order: 1,
          stream: "stderr",
          text: "session terminated after timeout\n",
        },
      ],
      {
        code: null,
        signal: "SIGKILL",
      },
    );

    expect(extractCodexCliSessionOutcome(transcript)).toEqual({
      type: "terminal_runtime_error",
      reasonCode: "process_exit_signaled",
      summary: "Codex CLI session exited from signal SIGKILL.",
      exit: {
        code: null,
        signal: "SIGKILL",
      },
    });
  });

  it("returns a terminal runtime error when the terminal outcome block is incomplete", () => {
    const transcript = makeTranscript([
      {
        order: 1,
        stream: "stdout",
        text: [
          "Research cycle done.\n",
          CODEX_CLI_SESSION_OUTCOME_BEGIN_MARKER,
          JSON.stringify({
            type: "proposal_result",
            reasonCode: "proposal_ready",
            summary: "Missing the terminal end marker.",
            changedPaths: ["reports/holdout-top3.md"],
            verificationArtifactPaths: ["artifacts/holdout-top3.json"],
          }),
        ].join("\n"),
      },
    ]);

    expect(extractCodexCliSessionOutcome(transcript)).toEqual({
      type: "terminal_runtime_error",
      reasonCode: "partial_terminal_outcome",
      summary: "Codex CLI transcript must contain exactly one complete terminal outcome block.",
      exit: {
        code: 0,
        signal: null,
      },
    });
  });

  it("returns a terminal runtime error when the terminal outcome JSON is malformed", () => {
    const transcript = makeTranscript([
      {
        order: 1,
        stream: "stdout",
        text: [
          CODEX_CLI_SESSION_OUTCOME_BEGIN_MARKER,
          "{\"type\":\"proposal_result\",\"reasonCode\":",
          CODEX_CLI_SESSION_OUTCOME_END_MARKER,
        ].join("\n"),
      },
    ]);

    expect(extractCodexCliSessionOutcome(transcript)).toEqual({
      type: "terminal_runtime_error",
      reasonCode: "invalid_terminal_outcome",
      summary: "Codex CLI terminal outcome block was not valid session outcome JSON.",
      exit: {
        code: 0,
        signal: null,
      },
    });
  });

  it("returns a terminal runtime error instead of accepting ambiguous duplicate outcome blocks", () => {
    const transcript = makeTranscript([
      {
        order: 1,
        stream: "stdout",
        text: [
          CODEX_CLI_SESSION_OUTCOME_BEGIN_MARKER,
          JSON.stringify({
            type: "explicit_failure",
            reasonCode: "no_meaningful_progress",
            summary: "No new artifacts were produced.",
            evidencePaths: [],
          }),
          CODEX_CLI_SESSION_OUTCOME_END_MARKER,
          CODEX_CLI_SESSION_OUTCOME_BEGIN_MARKER,
          JSON.stringify({
            type: "proposal_result",
            reasonCode: "proposal_ready",
            summary: "This second terminal block should invalidate the transcript.",
            changedPaths: ["reports/holdout-top3.md"],
            verificationArtifactPaths: ["artifacts/holdout-top3.json"],
          }),
          CODEX_CLI_SESSION_OUTCOME_END_MARKER,
        ].join("\n"),
      },
    ]);

    expect(extractCodexCliSessionOutcome(transcript)).toEqual({
      type: "terminal_runtime_error",
      reasonCode: "duplicate_terminal_outcomes",
      summary: "Codex CLI transcript must contain exactly one complete terminal outcome block.",
      exit: {
        code: 0,
        signal: null,
      },
    });
  });
});

function makeTranscript(
  entries: Array<{
    order: number;
    stream: "stdin" | "stdout" | "stderr";
    text: string;
    inputType?: "research_prompt" | "control";
    label?: string;
  }>,
  exit: { code: number | null; signal: NodeJS.Signals | null } = {
    code: 0,
    signal: null,
  },
): CodexCliSessionTranscript {
  return {
    sessionId: "session-001",
    pid: 42,
    startedAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:00:02.000Z",
    endedAt: "2026-04-12T00:00:02.000Z",
    exit,
    entries: entries.map((entry) => ({
      capturedAt: "2026-04-12T00:00:01.000Z",
      ...entry,
    })),
  };
}
