import { describe, expect, it } from "vitest";

import {
  codexCliSessionLifecycleSchema,
  parseCodexCliSessionLifecycleRecord,
  serializeCodexCliSessionLifecycleRecord,
  type CodexCliSessionLifecycleRecord,
} from "../src/core/model/codex-cli-session-lifecycle.js";

function makeLifecycle(
  overrides: Partial<CodexCliSessionLifecycleRecord> = {},
): CodexCliSessionLifecycleRecord {
  return {
    sessionId: "session-001",
    workingDirectory: "/workspace/repo",
    goal: "Reach the horse-racing holdout target.",
    resumeFromCycle: 3,
    completedCycles: 2,
    command: "codex",
    args: ["-C", "/workspace/repo", "-a", "never", "-s", "workspace-write"],
    approvalPolicy: "never",
    sandboxMode: "workspace-write",
    startedAt: "2026-04-12T00:10:30.000Z",
    updatedAt: "2026-04-12T00:11:00.000Z",
    phase: "running",
    pid: 3131,
    identity: {
      researchSessionId: "session-001",
      codexSessionId: "session-001",
      agent: "codex_cli",
    },
    tty: {
      stdinIsTty: true,
      stdoutIsTty: true,
      columns: 120,
      rows: 40,
      term: "xterm-256color",
      startupTimeoutSec: 30,
      turnTimeoutSec: 900,
    },
    attachmentState: {
      mode: "working_directory",
      status: "bound",
      workingDirectory: "/workspace/repo",
      trackedGlobs: ["**/*.md", "**/*.ts"],
      attachedPaths: [],
      extraWritableDirectories: ["/workspace/repo"],
    },
    references: {
      workspaceRef: "refs/heads/session-001",
      workspacePath: "/workspace/repo/.ralph/sessions/session-001/worktree",
      checkpointRunId: "run-002",
      checkpointDecisionId: "decision-002",
    },
    ...overrides,
  };
}

describe("codexCliSessionLifecycleSchema", () => {
  it("round-trips persisted lifecycle records with tty, attachment, and checkpoint references", () => {
    const record = makeLifecycle();

    const serialized = serializeCodexCliSessionLifecycleRecord(record);
    const parsed = parseCodexCliSessionLifecycleRecord(serialized);

    expect(parsed).toEqual(codexCliSessionLifecycleSchema.parse(record));
  });

  it("rejects explicit attached paths for working-directory-only sessions", () => {
    const result = codexCliSessionLifecycleSchema.safeParse(
      makeLifecycle({
        attachmentState: {
          mode: "working_directory",
          status: "bound",
          workingDirectory: "/workspace/repo",
          trackedGlobs: ["**/*.ts"],
          attachedPaths: ["README.md"],
          extraWritableDirectories: ["/workspace/repo"],
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["attachmentState", "attachedPaths"],
        }),
      ]),
    );
  });

  it("requires checkpoint run ids once completed cycles exist", () => {
    const result = codexCliSessionLifecycleSchema.safeParse(
      makeLifecycle({
        references: {
          workspaceRef: "refs/heads/session-001",
          workspacePath: "/workspace/repo/.ralph/sessions/session-001/worktree",
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["references", "checkpointRunId"],
        }),
      ]),
    );
  });

  it("requires terminal metadata for clean exits", () => {
    const result = codexCliSessionLifecycleSchema.safeParse(
      makeLifecycle({
        phase: "clean_exit",
        exit: undefined,
        endedAt: undefined,
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["exit"],
        }),
        expect.objectContaining({
          path: ["endedAt"],
        }),
      ]),
    );
  });
});
