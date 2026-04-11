import { describe, expect, it } from "vitest";

import {
  CodexCliSessionLifecycleService,
  classifyCodexCliSessionLifecycleInspection,
  resolveCodexCliSessionReuseOrReplaceDecision,
  validateCodexCliSessionAttachability,
} from "../src/app/services/codex-cli-session-lifecycle-service.js";
import { codexCliSessionLifecycleSchema, type CodexCliSessionLifecycleRecord } from "../src/core/model/codex-cli-session-lifecycle.js";
import {
  researchSessionRecordSchema,
  type ResearchSessionRecord,
} from "../src/core/model/research-session.js";
import type { ResearchSessionRecoveryInspection } from "../src/app/services/research-session-recovery-service.js";

describe("CodexCliSessionLifecycleService", () => {
  it("returns a reusable attachment target when the persisted lifecycle is still live and bound", async () => {
    const inspection = makeInspection({
      recovery: {
        classification: "inspect_only",
        resumeAllowed: false,
        reason: "Codex CLI still appears to be running for this session",
        runtime: {
          state: "active",
          processAlive: true,
          stale: false,
          pid: 3131,
          phase: "running",
          updatedAt: "2026-04-12T00:11:00.000Z",
        },
      },
      lifecycle: makeLifecycle({
        phase: "running",
        pid: 3131,
        attachmentState: {
          mode: "working_directory",
          status: "bound",
          workingDirectory: "/workspace/repo",
          trackedGlobs: ["analysis/**/*.md", "src/**/*.ts"],
          attachedPaths: [],
          extraWritableDirectories: ["/workspace/repo", "/workspace/repo/.ralph"],
        },
      }),
    });
    const service = new CodexCliSessionLifecycleService({
      recoveryService: {
        inspectSession: async () => inspection,
      },
    });

    const result = await service.inspectSession({
      repoRoot: "/workspace/repo",
      sessionId: "session-001",
    });

    expect(result).toMatchObject({
      kind: "reusable_attachment_target",
      session: {
        sessionId: "session-001",
        status: "running",
      },
      attachability: {
        mode: "attach",
        attachable: true,
        resumable: false,
      },
      target: {
        researchSessionId: "session-001",
        codexSessionId: "codex-session-001",
        pid: 3131,
        phase: "running",
        command: "codex",
        args: ["-C", "/workspace/repo"],
        workingDirectory: "/workspace/repo",
        attachmentStatus: "bound",
        trackedGlobs: ["analysis/**/*.md", "src/**/*.ts"],
        extraWritableDirectories: ["/workspace/repo", "/workspace/repo/.ralph"],
        workspaceRef: "refs/heads/session-001",
        workspacePath: "/workspace/repo/.ralph/sessions/session-001/worktree",
        checkpointRunId: "run-002",
        checkpointDecisionId: "decision-002",
      },
    });
  });

  it("resolves cycle startup to reuse when the persisted Codex reference is still attachable", async () => {
    const inspection = makeInspection({
      recovery: {
        classification: "inspect_only",
        resumeAllowed: false,
        reason: "Codex CLI still appears to be running for this session",
        runtime: {
          state: "active",
          processAlive: true,
          stale: false,
          pid: 3131,
          phase: "running",
          updatedAt: "2026-04-12T00:11:00.000Z",
        },
      },
      lifecycle: makeLifecycle({
        phase: "running",
        pid: 3131,
        attachmentState: {
          mode: "working_directory",
          status: "bound",
          workingDirectory: "/workspace/repo",
          trackedGlobs: ["analysis/**/*.md", "src/**/*.ts"],
          attachedPaths: [],
          extraWritableDirectories: ["/workspace/repo", "/workspace/repo/.ralph"],
        },
      }),
    });
    const service = new CodexCliSessionLifecycleService({
      recoveryService: {
        inspectSession: async () => inspection,
      },
    });

    await expect(
      service.resolveCycleSession({
        repoRoot: "/workspace/repo",
        sessionId: "session-001",
      }),
    ).resolves.toMatchObject({
      decision: "reuse",
      reason: "Codex CLI session is still live and bound to the persisted working-directory attachment",
      codexSessionReference: {
        codexSessionId: "codex-session-001",
        lifecyclePath: "/workspace/repo/.ralph/sessions/session-001/codex-session.json",
      },
      reuse: {
        researchSessionId: "session-001",
        codexSessionId: "codex-session-001",
        pid: 3131,
        phase: "running",
      },
    });
  });

  it("returns a stale session outcome when the runtime is no longer alive and only checkpoint evidence remains", async () => {
    const inspection = makeInspection({
      recovery: {
        classification: "resumable",
        resumeAllowed: true,
        reason: "Codex CLI is no longer live; resume from completed cycle boundary 3",
        runtime: {
          state: "stale",
          processAlive: false,
          stale: true,
          pid: 3131,
          phase: "running",
          updatedAt: "2026-04-12T00:11:00.000Z",
        },
      },
      lifecycle: makeLifecycle({
        phase: "running",
        pid: 3131,
        attachmentState: {
          mode: "working_directory",
          status: "bound",
          workingDirectory: "/workspace/repo",
          trackedGlobs: ["analysis/**/*.md", "src/**/*.ts"],
          attachedPaths: [],
          extraWritableDirectories: ["/workspace/repo"],
        },
      }),
    });
    const service = new CodexCliSessionLifecycleService({
      recoveryService: {
        inspectSession: async () => inspection,
      },
    });

    const result = await service.inspectSession({
      repoRoot: "/workspace/repo",
      sessionId: "session-001",
    });

    expect(result).toEqual({
      kind: "stale_session_outcome",
      session: inspection.session,
      lifecycle: inspection.lifecycle,
      recovery: inspection.recovery,
      attachability: {
        mode: "resume",
        attachable: false,
        resumable: true,
        reason: "Codex CLI is no longer live; resume from completed cycle boundary 3",
      },
      outcome: {
        runtimeState: "stale",
        completedCycles: 2,
        resumeFromCycle: 3,
        resumable: true,
        reason: "Codex CLI is no longer live; resume from completed cycle boundary 3",
        phase: "running",
        attachmentStatus: "bound",
      },
    });
  });

  it("downgrades validator drift to a safe stale session outcome instead of throwing", async () => {
    const inspection = makeInspection({
      recovery: {
        classification: "inspect_only",
        resumeAllowed: false,
        reason: "Codex CLI still appears to be running for this session",
        runtime: {
          state: "active",
          processAlive: true,
          stale: false,
          pid: 3131,
          phase: "running",
          updatedAt: "2026-04-12T00:11:00.000Z",
        },
      },
      lifecycle: makeLifecycle({
        phase: "running",
        pid: 3131,
        attachmentState: {
          mode: "working_directory",
          status: "released",
          workingDirectory: "/workspace/repo",
          trackedGlobs: ["analysis/**/*.md", "src/**/*.ts"],
          attachedPaths: [],
          extraWritableDirectories: ["/workspace/repo"],
        },
      }),
    });
    const service = new CodexCliSessionLifecycleService({
      recoveryService: {
        inspectSession: async () => inspection,
      },
      attachabilityValidator: () => ({
        mode: "attach",
        attachable: true,
        resumable: false,
        reason: "forced attachability drift",
      }),
    });

    await expect(
      service.inspectSession({
        repoRoot: "/workspace/repo",
        sessionId: "session-001",
      }),
    ).resolves.toEqual({
      kind: "stale_session_outcome",
      session: inspection.session,
      lifecycle: inspection.lifecycle,
      recovery: inspection.recovery,
      attachability: {
        mode: "inspect",
        attachable: false,
        resumable: false,
        reason: "Codex CLI process is live, but attachmentState.status is released instead of bound",
      },
      outcome: {
        runtimeState: "active",
        completedCycles: 2,
        resumeFromCycle: 3,
        resumable: false,
        reason: "Codex CLI still appears to be running for this session",
        phase: "running",
        attachmentStatus: "released",
      },
    });
  });

  it("returns a stale session outcome when lifecycle evidence is missing entirely", () => {
    const inspection = makeInspection({
      recovery: {
        classification: "inspect_only",
        resumeAllowed: false,
        reason: "running session is missing Codex lifecycle evidence",
        runtime: {
          state: "missing",
          processAlive: false,
          stale: false,
        },
      },
      lifecycle: null,
    });

    const result = classifyCodexCliSessionLifecycleInspection(inspection);

    expect(result).toEqual({
      kind: "stale_session_outcome",
      session: inspection.session,
      lifecycle: null,
      recovery: inspection.recovery,
      attachability: {
        mode: "inspect",
        attachable: false,
        resumable: false,
        reason: "running session is missing Codex lifecycle evidence",
      },
      outcome: {
        runtimeState: "missing",
        completedCycles: 2,
        resumeFromCycle: 3,
        resumable: false,
        reason: "running session is missing Codex lifecycle evidence",
      },
    });
  });

  it("resolves cycle startup to replace when the persisted Codex reference is missing", () => {
    const inspection = makeInspection({
      codexSessionReference: null,
      recovery: {
        classification: "inspect_only",
        resumeAllowed: false,
        reason: "Codex CLI still appears to be running for this session",
        runtime: {
          state: "active",
          processAlive: true,
          stale: false,
          pid: 3131,
          phase: "running",
          updatedAt: "2026-04-12T00:11:00.000Z",
        },
      },
      lifecycle: makeLifecycle({
        phase: "running",
        pid: 3131,
        attachmentState: {
          mode: "working_directory",
          status: "bound",
          workingDirectory: "/workspace/repo",
          trackedGlobs: ["analysis/**/*.md", "src/**/*.ts"],
          attachedPaths: [],
          extraWritableDirectories: ["/workspace/repo"],
        },
      }),
    });

    expect(resolveCodexCliSessionReuseOrReplaceDecision(inspection)).toEqual({
      decision: "replace",
      session: inspection.session,
      lifecycle: inspection.lifecycle,
      recovery: inspection.recovery,
      codexSessionReference: null,
      reason: "Persisted Codex session reference is missing",
      replace: {
        runtimeState: "active",
        completedCycles: 2,
        resumeFromCycle: 3,
        resumable: false,
        reason: "Codex CLI still appears to be running for this session",
        phase: "running",
        attachmentStatus: "bound",
        attachabilityMode: "inspect",
      },
    });
  });

  it("marks live sessions with released attachments as inspect-only instead of resumable", () => {
    const inspection = makeInspection({
      recovery: {
        classification: "inspect_only",
        resumeAllowed: false,
        reason: "Codex CLI still appears to be running for this session",
        runtime: {
          state: "active",
          processAlive: true,
          stale: false,
          pid: 3131,
          phase: "running",
          updatedAt: "2026-04-12T00:11:00.000Z",
        },
      },
      lifecycle: makeLifecycle({
        phase: "running",
        pid: 3131,
        attachmentState: {
          mode: "working_directory",
          status: "released",
          workingDirectory: "/workspace/repo",
          trackedGlobs: ["analysis/**/*.md", "src/**/*.ts"],
          attachedPaths: [],
          extraWritableDirectories: ["/workspace/repo"],
        },
      }),
    });

    expect(validateCodexCliSessionAttachability(inspection)).toEqual({
      mode: "inspect",
      attachable: false,
      resumable: false,
      reason: "Codex CLI process is live, but attachmentState.status is released instead of bound",
    });
  });

  it("prefers resumable checkpoint recovery when the referenced session is no longer attachable", () => {
    const inspection = makeInspection({
      recovery: {
        classification: "resumable",
        resumeAllowed: true,
        reason: "Codex CLI exited cleanly before cycle 3 completed",
        runtime: {
          state: "exited",
          processAlive: false,
          stale: false,
          phase: "clean_exit",
          updatedAt: "2026-04-12T00:11:00.000Z",
        },
      },
      lifecycle: makeLifecycle({
        phase: "clean_exit",
        attachmentState: {
          mode: "working_directory",
          status: "released",
          workingDirectory: "/workspace/repo",
          trackedGlobs: ["analysis/**/*.md", "src/**/*.ts"],
          attachedPaths: [],
          extraWritableDirectories: ["/workspace/repo"],
        },
      }),
    });

    expect(validateCodexCliSessionAttachability(inspection)).toEqual({
      mode: "resume",
      attachable: false,
      resumable: true,
      reason: "Codex CLI exited cleanly before cycle 3 completed",
    });
  });
});

function makeInspection(overrides: {
  session?: ResearchSessionRecord;
  lifecycle?: CodexCliSessionLifecycleRecord | null;
  codexSessionReference?: ResearchSessionRecoveryInspection["codexSessionReference"];
  recovery?: ResearchSessionRecoveryInspection["recovery"];
} = {}): ResearchSessionRecoveryInspection {
  return {
    session: overrides.session ?? makeSession(),
    lifecycle: overrides.lifecycle === undefined ? makeLifecycle() : overrides.lifecycle,
    codexSessionReference:
      overrides.codexSessionReference === undefined
        ? {
            codexSessionId: "codex-session-001",
            lifecyclePath: "/workspace/repo/.ralph/sessions/session-001/codex-session.json",
          }
        : overrides.codexSessionReference,
    recovery: overrides.recovery ?? {
      classification: "resumable",
      resumeAllowed: true,
      reason: "Codex CLI exited cleanly before cycle 3 completed",
      runtime: {
        state: "exited",
        processAlive: false,
        stale: false,
        phase: "clean_exit",
        updatedAt: "2026-04-12T00:11:00.000Z",
      },
    },
  };
}

function makeSession(overrides: Partial<ResearchSessionRecord> = {}): ResearchSessionRecord {
  return researchSessionRecordSchema.parse({
    sessionId: "session-001",
    goal: "Reach 70% future holdout top-3 prediction success.",
    workingDirectory: "/workspace/repo",
    status: "running",
    agent: {
      type: "codex_cli",
      command: "codex",
    },
    workspace: {
      strategy: "git_worktree",
      currentRef: "refs/heads/session-001",
      currentPath: "/workspace/repo/.ralph/sessions/session-001/worktree",
      promoted: false,
    },
    progress: {
      completedCycles: 2,
      nextCycle: 3,
      latestRunId: "run-002",
      latestDecisionId: "decision-002",
      latestFrontierIds: ["frontier-002"],
      repeatedFailureStreak: 0,
      noMeaningfulProgressStreak: 0,
      insufficientEvidenceStreak: 0,
      lastCheckpointAt: "2026-04-12T00:10:00.000Z",
      lastSignals: {
        cycle: 2,
        outcome: "accepted",
        changedFileCount: 2,
        diffLineCount: 18,
        repeatedDiff: false,
        newArtifacts: ["reports/holdout-002.json"],
        meaningfulProgress: true,
        insufficientEvidence: false,
        agentTieBreakerUsed: false,
        reasons: ["Persisted a stronger holdout bundle."],
      },
    },
    stopCondition: {
      type: "none",
    },
    resume: {
      resumable: true,
      checkpointType: "completed_cycle_boundary",
      resumeFromCycle: 3,
      requiresUserConfirmation: false,
      checkpointRunId: "run-002",
      checkpointDecisionId: "decision-002",
    },
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:10:00.000Z",
    ...overrides,
  });
}

function makeLifecycle(
  overrides: Partial<CodexCliSessionLifecycleRecord> = {},
): CodexCliSessionLifecycleRecord {
  const record = {
    sessionId: "session-001",
    workingDirectory: "/workspace/repo",
    goal: "Reach 70% future holdout top-3 prediction success.",
    resumeFromCycle: 3,
    completedCycles: 2,
    command: "codex",
    args: ["-C", "/workspace/repo"],
    approvalPolicy: "never",
    sandboxMode: "workspace-write",
    startedAt: "2026-04-12T00:09:00.000Z",
    updatedAt: "2026-04-12T00:11:00.000Z",
    phase: "clean_exit",
    endedAt: "2026-04-12T00:11:00.000Z",
    exit: {
      code: 0,
      signal: null,
    },
    identity: {
      researchSessionId: "session-001",
      codexSessionId: "codex-session-001",
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
      status: "released",
      workingDirectory: "/workspace/repo",
      trackedGlobs: ["analysis/**/*.md", "src/**/*.ts"],
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

  if (record.phase === "starting" || record.phase === "running") {
    delete record.endedAt;
    delete record.exit;
  }

  return codexCliSessionLifecycleSchema.parse(record);
}
