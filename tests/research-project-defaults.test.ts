import { describe, expect, it } from "vitest";

import {
  researchProjectDefaultsRecordSchema,
  type ResearchProjectDefaultsRecord,
} from "../src/core/model/research-project-defaults.js";

function makeProjectDefaults(
  overrides: Partial<ResearchProjectDefaultsRecord> = {},
): ResearchProjectDefaultsRecord {
  return {
    recordType: "research_project_defaults",
    version: 1,
    workingDirectory: "/tmp/demo",
    context: {
      trackableGlobs: ["reports/**/*.json", "src/**/*.ts"],
      webSearch: true,
      shellCommandAllowlistAdditions: ["git status", "git diff"],
      shellCommandAllowlistRemovals: ["rm"],
    },
    workspace: {
      strategy: "git_worktree",
      baseRef: "main",
    },
    agent: {
      type: "codex_cli",
      command: "codex",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      ttySession: {
        startupTimeoutSec: 30,
        turnTimeoutSec: 900,
      },
    },
    stopPolicy: {
      repeatedFailures: 3,
      noMeaningfulProgress: 5,
      insufficientEvidence: 3,
    },
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("researchProjectDefaultsRecordSchema", () => {
  it("applies the project contract defaults without depending on a launch review snapshot", () => {
    const parsed = researchProjectDefaultsRecordSchema.parse({
      workingDirectory: "/tmp/demo",
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:00.000Z",
    });

    expect(parsed.recordType).toBe("research_project_defaults");
    expect(parsed.version).toBe(1);
    expect(parsed.workspace).toEqual({
      strategy: "git_worktree",
      baseRef: "main",
    });
    expect(parsed.agent).toMatchObject({
      type: "codex_cli",
      command: "codex",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      ttySession: {
        startupTimeoutSec: 30,
        turnTimeoutSec: 900,
      },
    });
    expect(parsed.stopPolicy).toEqual({
      repeatedFailures: 3,
      noMeaningfulProgress: 5,
      insufficientEvidence: 3,
    });
  });

  it("rejects launch-draft review snapshot fields and runtime workspace state", () => {
    const result = researchProjectDefaultsRecordSchema.safeParse({
      ...makeProjectDefaults(),
      draftState: {
        currentStep: "review",
      },
      workspace: {
        strategy: "git_worktree",
        baseRef: "main",
        currentPath: "/tmp/demo/.ralph/sessions/launch-draft/worktree",
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: [],
          message: expect.stringMatching(/unrecognized key/i),
        }),
        expect.objectContaining({
          path: ["workspace"],
          message: expect.stringMatching(/unrecognized key/i),
        }),
      ]),
    );
  });
});
