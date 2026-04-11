import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonFileResearchSessionRepository } from "../src/adapters/fs/json-file-research-session-repository.js";
import { ResearchSessionRecoveryService } from "../src/app/services/research-session-recovery-service.js";
import {
  serializeCodexCliSessionLifecycleRecord,
  type CodexCliSessionLifecycleRecord,
} from "../src/core/model/codex-cli-session-lifecycle.js";
import { researchSessionRecordSchema, type ResearchSessionRecord } from "../src/core/model/research-session.js";
import type { ResearchSessionRepository } from "../src/core/ports/research-session-repository.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-session-recovery-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("ResearchSessionRecoveryService", () => {
  it("prefers persisted session bundle loading so lifecycle checks can reuse the stored Codex session reference", async () => {
    const session = makeSession();
    const lifecycle = makeLifecycle({
      identity: {
        researchSessionId: "session-001",
        codexSessionId: "codex-session-999",
        agent: "codex_cli",
      },
    });
    let legacyLoadSessionCalls = 0;
    const repository: ResearchSessionRepository = {
      saveSession: async () => {
        throw new Error("saveSession should not be called during recovery inspection");
      },
      loadSession: async () => {
        legacyLoadSessionCalls += 1;
        throw new Error("inspectSession should use loadPersistedSession when available");
      },
      loadPersistedSession: async (sessionId) => {
        expect(sessionId).toBe("session-001");
        return {
          session,
          lifecycle,
          codexSessionReference: {
            codexSessionId: "codex-session-999",
            lifecyclePath: join(tempRoot, ".ralph", "sessions", "session-001", "codex-session.json"),
          },
        };
      },
      querySessions: async () => [],
    };

    const service = new ResearchSessionRecoveryService({
      createRepository: () => repository,
      isProcessAlive: () => false,
    });

    const inspection = await service.inspectSession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(legacyLoadSessionCalls).toBe(0);
    expect(inspection.lifecycle?.identity.codexSessionId).toBe("codex-session-999");
    expect(inspection.recovery).toMatchObject({
      classification: "resumable",
      resumeAllowed: true,
      runtime: {
        state: "stale",
        processAlive: false,
        phase: "running",
      },
    });
  });

  it("reloads persisted Codex identity, attachment state, and checkpoint workspace associations for awaiting_resume sessions", async () => {
    const workspacePath = join(tempRoot, ".ralph", "workspaces", "candidate-004");
    await saveSession(
      makeSession({
        status: "awaiting_resume",
        context: {
          trackableGlobs: ["reports/**/*.json", "src/**/*.ts"],
          webSearch: true,
          shellCommandAllowlistAdditions: [],
          shellCommandAllowlistRemovals: [],
        },
        workspace: {
          strategy: "git_worktree",
          currentRef: "refs/heads/candidate-004",
          currentPath: workspacePath,
          promoted: false,
        },
        progress: {
          completedCycles: 4,
          nextCycle: 5,
          latestRunId: "run-004",
          latestDecisionId: "decision-004",
          latestFrontierIds: ["frontier-004"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 1,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 4,
          lastCheckpointAt: "2026-04-12T00:14:00.000Z",
          lastSignals: {
            cycle: 4,
            outcome: "accepted",
            changedFileCount: 3,
            diffLineCount: 27,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["Persisted a stronger future holdout report bundle."],
            newArtifacts: ["reports/future-holdout-cycle-004.json"],
            repeatedDiff: false,
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 5,
          requiresUserConfirmation: true,
          checkpointRunId: "run-004",
          checkpointDecisionId: "decision-004",
          interruptionDetectedAt: "2026-04-12T00:14:30.000Z",
          interruptedDuringCycle: 5,
          note: "Codex exited after cycle 4 checkpoint persisted.",
        },
      }),
    );
    await saveLifecycle(
      makeLifecycle({
        resumeFromCycle: 5,
        completedCycles: 4,
        phase: "clean_exit",
        endedAt: "2026-04-12T00:14:31.000Z",
        exit: {
          code: 0,
          signal: null,
        },
        identity: {
          researchSessionId: "session-001",
          codexSessionId: "codex-session-004",
          agent: "codex_cli",
        },
        attachmentState: {
          mode: "working_directory",
          status: "released",
          workingDirectory: tempRoot,
          trackedGlobs: ["reports/**/*.json", "src/**/*.ts"],
          attachedPaths: [],
          extraWritableDirectories: [tempRoot],
        },
        references: {
          workspaceRef: "refs/heads/candidate-004",
          workspacePath,
          checkpointRunId: "run-004",
          checkpointDecisionId: "decision-004",
        },
      }),
    );

    const service = new ResearchSessionRecoveryService({
      isProcessAlive: () => false,
    });

    const inspection = await service.inspectSession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(inspection.session.resume).toMatchObject({
      resumeFromCycle: 5,
      checkpointRunId: "run-004",
      checkpointDecisionId: "decision-004",
    });
    expect(inspection.lifecycle).toMatchObject({
      sessionId: "session-001",
      resumeFromCycle: 5,
      completedCycles: 4,
      phase: "clean_exit",
      identity: {
        researchSessionId: "session-001",
        codexSessionId: "codex-session-004",
        agent: "codex_cli",
      },
      attachmentState: {
        status: "released",
        workingDirectory: tempRoot,
        trackedGlobs: ["reports/**/*.json", "src/**/*.ts"],
        extraWritableDirectories: [tempRoot],
      },
      references: {
        workspaceRef: "refs/heads/candidate-004",
        workspacePath,
        checkpointRunId: "run-004",
        checkpointDecisionId: "decision-004",
      },
    });
    expect(inspection.recovery).toMatchObject({
      classification: "resumable",
      resumeAllowed: true,
      runtime: {
        state: "exited",
        processAlive: false,
        phase: "clean_exit",
      },
    });
  });

  it("reloads stale running lifecycle records with bound attachments and latest checkpoint workspace/run metadata intact", async () => {
    const workspacePath = join(tempRoot, ".ralph", "workspaces", "candidate-006");
    await saveSession(
      makeSession({
        status: "running",
        context: {
          trackableGlobs: ["analysis/**/*.md", "src/**/*.ts"],
          webSearch: true,
          shellCommandAllowlistAdditions: [],
          shellCommandAllowlistRemovals: [],
        },
        workspace: {
          strategy: "git_worktree",
          currentRef: "refs/heads/candidate-006",
          currentPath: workspacePath,
          promoted: false,
        },
        progress: {
          completedCycles: 6,
          nextCycle: 7,
          latestRunId: "run-006",
          latestDecisionId: "decision-006",
          latestFrontierIds: ["frontier-006"],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 6,
          lastCheckpointAt: "2026-04-12T00:16:00.000Z",
          lastSignals: {
            cycle: 6,
            outcome: "accepted",
            changedFileCount: 2,
            diffLineCount: 16,
            meaningfulProgress: true,
            insufficientEvidence: false,
            agentTieBreakerUsed: false,
            reasons: ["Saved the current candidate workspace before the next cycle."],
            newArtifacts: ["analysis/cycle-006.md"],
            repeatedDiff: false,
          },
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 7,
          requiresUserConfirmation: false,
          checkpointRunId: "run-006",
          checkpointDecisionId: "decision-006",
        },
      }),
    );
    await saveLifecycle(
      makeLifecycle({
        resumeFromCycle: 7,
        completedCycles: 6,
        phase: "running",
        pid: 6161,
        identity: {
          researchSessionId: "session-001",
          codexSessionId: "codex-session-006",
          agent: "codex_cli",
        },
        attachmentState: {
          mode: "working_directory",
          status: "bound",
          workingDirectory: tempRoot,
          trackedGlobs: ["analysis/**/*.md", "src/**/*.ts"],
          attachedPaths: [],
          extraWritableDirectories: [tempRoot],
        },
        references: {
          workspaceRef: "refs/heads/candidate-006",
          workspacePath,
          checkpointRunId: "run-006",
          checkpointDecisionId: "decision-006",
        },
      }),
    );

    const service = new ResearchSessionRecoveryService({
      isProcessAlive: () => false,
    });

    const inspection = await service.inspectSession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(inspection.lifecycle).toMatchObject({
      phase: "running",
      pid: 6161,
      identity: {
        codexSessionId: "codex-session-006",
      },
      attachmentState: {
        status: "bound",
        trackedGlobs: ["analysis/**/*.md", "src/**/*.ts"],
      },
      references: {
        workspaceRef: "refs/heads/candidate-006",
        workspacePath,
        checkpointRunId: "run-006",
        checkpointDecisionId: "decision-006",
      },
    });
    expect(inspection.recovery).toMatchObject({
      classification: "resumable",
      resumeAllowed: true,
      runtime: {
        state: "stale",
        processAlive: false,
        stale: true,
        phase: "running",
      },
    });
    expect(inspection.recovery.reason).toContain("completed cycle boundary 7");
  });

  it("classifies a clean interrupted Codex session as resumable", async () => {
    await saveSession(
      makeSession({
        status: "awaiting_resume",
      }),
    );
    await saveLifecycle(
      makeLifecycle({
        phase: "clean_exit",
        pid: 4242,
        endedAt: "2026-04-12T00:12:05.000Z",
        exit: {
          code: 0,
          signal: null,
        },
      }),
    );

    const service = new ResearchSessionRecoveryService({
      isProcessAlive: () => false,
    });

    const recovery = await service.classifySession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(recovery).toMatchObject({
      classification: "resumable",
      resumeAllowed: true,
      runtime: {
        state: "exited",
        processAlive: false,
        phase: "clean_exit",
      },
    });
    expect(recovery.reason).toContain("exited cleanly");
  });

  it("classifies a stale running lifecycle without a live process as resumable from the checkpoint boundary", async () => {
    await saveSession(
      makeSession({
        status: "running",
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: false,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
        },
      }),
    );
    await saveLifecycle(
      makeLifecycle({
        phase: "running",
        pid: 5151,
      }),
    );

    const service = new ResearchSessionRecoveryService({
      isProcessAlive: () => false,
    });

    const recovery = await service.classifySession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(recovery).toMatchObject({
      classification: "resumable",
      resumeAllowed: true,
      runtime: {
        state: "stale",
        processAlive: false,
        stale: true,
        phase: "running",
      },
    });
    expect(recovery.reason).toContain("completed cycle boundary 3");
  });

  it("classifies a live running Codex process as inspect_only", async () => {
    await saveSession(
      makeSession({
        status: "running",
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 3,
          requiresUserConfirmation: false,
          checkpointRunId: "run-002",
          checkpointDecisionId: "decision-002",
        },
      }),
    );
    await saveLifecycle(
      makeLifecycle({
        phase: "running",
        pid: process.pid,
      }),
    );

    const service = new ResearchSessionRecoveryService({
      isProcessAlive: () => true,
    });

    const recovery = await service.classifySession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(recovery).toMatchObject({
      classification: "inspect_only",
      resumeAllowed: false,
      runtime: {
        state: "active",
        processAlive: true,
      },
    });
    expect(recovery.reason).toContain("still appears to be running");
  });

  it("classifies missing lifecycle evidence as inspect_only instead of resuming blindly", async () => {
    await saveSession(
      makeSession({
        status: "awaiting_resume",
      }),
    );

    const service = new ResearchSessionRecoveryService({
      isProcessAlive: () => false,
    });

    const recovery = await service.classifySession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(recovery).toMatchObject({
      classification: "inspect_only",
      resumeAllowed: false,
      runtime: {
        state: "missing",
        processAlive: false,
      },
    });
    expect(recovery.reason).toContain("missing Codex lifecycle evidence");
  });

  it("classifies halted sessions as resumable from the persisted checkpoint boundary", async () => {
    await saveSession(
      makeSession({
        status: "halted",
        stopCondition: {
          type: "repeated_failures",
          count: 3,
          threshold: 3,
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 4,
          requiresUserConfirmation: true,
          checkpointRunId: "run-003",
          checkpointDecisionId: "decision-003",
        },
        progress: {
          completedCycles: 3,
          nextCycle: 4,
          latestRunId: "run-003",
          latestDecisionId: "decision-003",
          latestFrontierIds: ["frontier-003"],
          repeatedFailureStreak: 3,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
          lastMeaningfulProgressCycle: 2,
          lastCheckpointAt: "2026-04-12T00:12:00.000Z",
          lastSignals: {
            cycle: 3,
            outcome: "failed",
            changedFileCount: 0,
            diffLineCount: 0,
            meaningfulProgress: false,
            insufficientEvidence: true,
            agentTieBreakerUsed: false,
            reasons: ["The halted session stopped after another verifier failure."],
            newArtifacts: [],
            repeatedDiff: true,
          },
        },
      }),
    );

    const service = new ResearchSessionRecoveryService({
      isProcessAlive: () => false,
    });

    const recovery = await service.classifySession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(recovery).toMatchObject({
      classification: "resumable",
      resumeAllowed: true,
      runtime: {
        state: "missing",
        processAlive: false,
      },
    });
    expect(recovery.reason).toContain("halted after 3 repeated failures");
    expect(recovery.reason).toContain("completed cycle boundary 4");
  });

  it("classifies non-zero Codex exits as non_recoverable", async () => {
    await saveSession(
      makeSession({
        status: "awaiting_resume",
      }),
    );
    await saveLifecycle(
      makeLifecycle({
        phase: "non_zero_exit",
        pid: 7070,
        endedAt: "2026-04-12T00:12:05.000Z",
        exit: {
          code: 2,
          signal: null,
        },
      }),
    );

    const service = new ResearchSessionRecoveryService({
      isProcessAlive: () => false,
    });

    const recovery = await service.classifySession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(recovery).toMatchObject({
      classification: "non_recoverable",
      resumeAllowed: false,
      runtime: {
        state: "exited",
        processAlive: false,
        phase: "non_zero_exit",
      },
    });
    expect(recovery.reason).toContain("exited with code 2");
  });

  it("classifies contradictory lifecycle checkpoint metadata as non_recoverable", async () => {
    await saveSession(
      makeSession({
        status: "awaiting_resume",
      }),
    );
    await saveLifecycle(
      makeLifecycle({
        resumeFromCycle: 4,
        phase: "signaled",
        endedAt: "2026-04-12T00:12:05.000Z",
        exit: {
          code: null,
          signal: "SIGINT",
        },
      }),
    );

    const service = new ResearchSessionRecoveryService({
      isProcessAlive: () => false,
    });

    const recovery = await service.classifySession({
      repoRoot: tempRoot,
      sessionId: "session-001",
    });

    expect(recovery).toMatchObject({
      classification: "non_recoverable",
      resumeAllowed: false,
    });
    expect(recovery.reason).toContain("resumeFromCycle");
  });
});

function makeSession(overrides: Partial<ResearchSessionRecord> = {}): ResearchSessionRecord {
  return researchSessionRecordSchema.parse({
    sessionId: "session-001",
    goal: "Reach the horse-racing holdout target.",
    workingDirectory: tempRoot,
    status: "awaiting_resume",
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
    workspace: {
      strategy: "git_worktree",
      currentRef: "refs/heads/session-001",
      currentPath: join(tempRoot, ".ralph", "sessions", "session-001", "worktree"),
      promoted: false,
    },
    stopPolicy: {
      repeatedFailures: 3,
      noMeaningfulProgress: 5,
      insufficientEvidence: 3,
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
        diffLineCount: 14,
        meaningfulProgress: true,
        insufficientEvidence: false,
        agentTieBreakerUsed: false,
        reasons: ["Saved the latest holdout report."],
        newArtifacts: ["reports/holdout-cycle-002.json"],
        repeatedDiff: false,
      },
    },
    stopCondition: {
      type: "none",
    },
    resume: {
      resumable: true,
      checkpointType: "completed_cycle_boundary",
      resumeFromCycle: 3,
      requiresUserConfirmation: true,
      checkpointRunId: "run-002",
      checkpointDecisionId: "decision-002",
      interruptionDetectedAt: "2026-04-12T00:11:00.000Z",
      interruptedDuringCycle: 3,
      note: "Codex session ended while preparing cycle 3.",
    },
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:11:00.000Z",
    ...overrides,
  });
}

function makeLifecycle(
  overrides: Partial<CodexCliSessionLifecycleRecord> = {},
): CodexCliSessionLifecycleRecord {
  return {
    sessionId: "session-001",
    workingDirectory: tempRoot,
    goal: "Reach the horse-racing holdout target.",
    resumeFromCycle: 3,
    completedCycles: 2,
    command: "codex",
    args: ["-C", tempRoot, "-a", "never", "-s", "workspace-write"],
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
      startupTimeoutSec: 30,
      turnTimeoutSec: 900,
    },
    attachmentState: {
      mode: "working_directory",
      status: "bound",
      workingDirectory: tempRoot,
      trackedGlobs: ["**/*.md", "**/*.txt", "**/*.py", "**/*.ts", "**/*.tsx"],
      attachedPaths: [],
      extraWritableDirectories: [tempRoot],
    },
    references: {
      workspaceRef: "refs/heads/session-001",
      workspacePath: join(tempRoot, ".ralph", "sessions", "session-001", "worktree"),
      checkpointRunId: "run-002",
      checkpointDecisionId: "decision-002",
    },
    ...overrides,
  };
}

async function saveSession(session: ResearchSessionRecord): Promise<void> {
  const repository = new JsonFileResearchSessionRepository(join(tempRoot, ".ralph", "sessions"));
  await repository.saveSession(session);
}

async function saveLifecycle(lifecycle: CodexCliSessionLifecycleRecord): Promise<void> {
  const lifecyclePath = join(
    tempRoot,
    ".ralph",
    "sessions",
    lifecycle.sessionId,
    "codex-session.json",
  );
  await mkdir(join(tempRoot, ".ralph", "sessions", lifecycle.sessionId), {
    recursive: true,
  });
  await writeFile(lifecyclePath, serializeCodexCliSessionLifecycleRecord(lifecycle), "utf8");
}
