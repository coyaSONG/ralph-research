import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonFileDecisionStore } from "../src/adapters/fs/json-file-decision-store.js";
import { JsonFileFrontierStore } from "../src/adapters/fs/json-file-frontier-store.js";
import { JsonFileResearchProjectDefaultsStore } from "../src/adapters/fs/json-file-research-project-defaults-store.js";
import { JsonFileResearchSessionRepository } from "../src/adapters/fs/json-file-research-session-repository.js";
import { JsonFileRunStore } from "../src/adapters/fs/json-file-run-store.js";
import {
  codexCliSessionLifecycleSchema,
  serializeCodexCliSessionLifecycleRecord,
  type CodexCliSessionLifecycleRecord,
} from "../src/core/model/codex-cli-session-lifecycle.js";
import type { DecisionRecord } from "../src/core/model/decision-record.js";
import type { FrontierEntry } from "../src/core/model/frontier-entry.js";
import {
  researchProjectDefaultsRecordSchema,
  type ResearchProjectDefaultsRecord,
} from "../src/core/model/research-project-defaults.js";
import {
  buildResearchSessionMetadata,
  researchSessionRecordSchema,
  type ResearchSessionRecord,
} from "../src/core/model/research-session.js";
import type { RunRecord } from "../src/core/model/run-record.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-stores-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-001",
    cycle: 1,
    candidateId: "candidate-001",
    status: "running",
    phase: "started",
    pendingAction: "prepare_proposal",
    startedAt: "2026-03-29T00:00:00.000Z",
    manifestHash: "manifest-hash",
    workspaceRef: "main",
    workspacePath: "/tmp/workspace",
    proposal: {
      proposerType: "operator_llm",
      summary: "Proposed a bounded patch.",
      operators: ["strengthen_claim_evidence"],
      patchPath: "/tmp/patch.diff",
      diffLines: 4,
      withinBudget: true,
    },
    artifacts: [
      {
        id: "draft",
        path: "/tmp/draft.md",
      },
    ],
    metrics: {},
    constraints: [],
    logs: {
      proposeStdoutPath: "/tmp/propose.log",
    },
    ...overrides,
  };
}

function makeDecisionRecord(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    decisionId: "decision-001",
    runId: "run-001",
    outcome: "accepted",
    actorType: "system",
    policyType: "epsilon_improve",
    metricId: "tests_passed",
    delta: 1,
    reason: "candidate_value=2, baseline_value=1, within_budget=True",
    createdAt: "2026-03-29T00:10:00.000Z",
    frontierChanged: true,
    beforeFrontierIds: ["frontier-000"],
    afterFrontierIds: ["frontier-001"],
    commitSha: "abc123",
    auditRequired: false,
    ...overrides,
  };
}

function makeFrontierEntry(overrides: Partial<FrontierEntry> = {}): FrontierEntry {
  return {
    frontierId: "frontier-001",
    runId: "run-001",
    candidateId: "candidate-001",
    acceptedAt: "2026-03-29T00:10:00.000Z",
    commitSha: "abc123",
    metrics: {
      tests_passed: {
        metricId: "tests_passed",
        value: 2,
        direction: "maximize",
        details: {},
      },
    },
    artifacts: [
      {
        id: "patch",
        path: "/tmp/patch.diff",
      },
    ],
    ...overrides,
  };
}

function makeResearchSession(overrides: Partial<ResearchSessionRecord> = {}): ResearchSessionRecord {
  return {
    sessionId: "session-001",
    goal: "Reach the horse-racing holdout target.",
    workingDirectory: "/tmp/demo",
    status: "awaiting_resume",
    agent: {
      type: "codex_cli",
      command: "codex",
    },
    workspace: {
      strategy: "git_worktree",
      currentRef: "refs/heads/session-001",
      currentPath: "/tmp/demo/.ralph/sessions/session-001/worktree",
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
      latestFrontierIds: ["frontier-001"],
      repeatedFailureStreak: 0,
      noMeaningfulProgressStreak: 0,
      insufficientEvidenceStreak: 0,
      lastCheckpointAt: "2026-04-12T00:10:00.000Z",
      lastSignals: {
        cycle: 2,
        outcome: "accepted",
        changedFileCount: 3,
        diffLineCount: 41,
        meaningfulProgress: true,
        reasons: ["Created a new evaluation report."],
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
      interruptionDetectedAt: "2026-04-12T00:12:00.000Z",
      interruptedDuringCycle: 3,
    },
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:12:00.000Z",
    ...overrides,
  };
}

function makeResearchProjectDefaults(
  overrides: Partial<ResearchProjectDefaultsRecord> = {},
): ResearchProjectDefaultsRecord {
  return {
    recordType: "research_project_defaults",
    version: 1,
    workingDirectory: "/tmp/demo",
    context: {
      trackableGlobs: ["reports/**/*.json", "src/**/*.ts"],
      webSearch: true,
      shellCommandAllowlistAdditions: ["git status"],
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

function makeCodexCliSessionLifecycle(
  overrides: Partial<CodexCliSessionLifecycleRecord> = {},
): CodexCliSessionLifecycleRecord {
  const record = {
    sessionId: "session-001",
    workingDirectory: "/tmp/demo",
    goal: "Reach the horse-racing holdout target.",
    resumeFromCycle: 3,
    completedCycles: 2,
    command: "codex",
    args: ["-C", "/tmp/demo", "-a", "never", "-s", "workspace-write"],
    approvalPolicy: "never",
    sandboxMode: "workspace-write",
    startedAt: "2026-04-12T00:08:00.000Z",
    updatedAt: "2026-04-12T00:12:00.000Z",
    phase: "clean_exit",
    endedAt: "2026-04-12T00:12:00.000Z",
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
      startupTimeoutSec: 30,
      turnTimeoutSec: 900,
    },
    attachmentState: {
      mode: "working_directory",
      status: "released",
      workingDirectory: "/tmp/demo",
      trackedGlobs: ["**/*.md", "**/*.txt", "**/*.py", "**/*.ts", "**/*.tsx"],
      attachedPaths: [],
      extraWritableDirectories: ["/tmp/demo"],
    },
    references: {
      workspaceRef: "refs/heads/session-001",
      workspacePath: "/tmp/demo/.ralph/sessions/session-001/worktree",
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

describe("JSON file stores", () => {
  it("round-trips run records with pendingAction and intermediate phase intact", async () => {
    const store = new JsonFileRunStore(join(tempRoot, "runs"));
    const original = makeRunRecord({
      phase: "decision_written",
      status: "evaluated",
      pendingAction: "commit_candidate",
      decisionId: "decision-001",
    });

    await store.put(original);
    const loaded = await store.get(original.runId);

    expect(loaded).toEqual(original);
    expect(loaded?.phase).toBe("decision_written");
    expect(loaded?.pendingAction).toBe("commit_candidate");
  });

  it("lists saved run records in stable order", async () => {
    const store = new JsonFileRunStore(join(tempRoot, "runs"));
    await store.put(makeRunRecord({ runId: "run-002", candidateId: "candidate-002" }));
    await store.put(makeRunRecord({ runId: "run-001", candidateId: "candidate-001" }));

    const records = await store.list();

    expect(records.map((record) => record.runId)).toEqual(["run-001", "run-002"]);
  });

  it("round-trips decision records", async () => {
    const store = new JsonFileDecisionStore(join(tempRoot, "decisions"));
    const original = makeDecisionRecord();

    await store.put(original);
    const loaded = await store.get(original.decisionId);

    expect(loaded).toEqual(original);
  });

  it("round-trips frontier snapshots", async () => {
    const store = new JsonFileFrontierStore(join(tempRoot, "frontier.json"));
    const snapshot = [
      makeFrontierEntry(),
      makeFrontierEntry({
        frontierId: "frontier-002",
        runId: "run-002",
        candidateId: "candidate-002",
      }),
    ];

    await store.save(snapshot);
    const loaded = await store.load();

    expect(loaded).toEqual(snapshot);
  });

  it("supports saving a recoverable intermediate run phase and then updating to completed", async () => {
    const store = new JsonFileRunStore(join(tempRoot, "runs"));
    const recoverable = makeRunRecord({
      phase: "committed",
      status: "evaluated",
      pendingAction: "update_frontier",
      decisionId: "decision-001",
    });

    await store.put(recoverable);
    const loadedRecoverable = await store.get(recoverable.runId);
    expect(loadedRecoverable?.phase).toBe("committed");
    expect(loadedRecoverable?.pendingAction).toBe("update_frontier");

    const completed = {
      ...recoverable,
      status: "accepted" as const,
      phase: "completed" as const,
      pendingAction: "none" as const,
      endedAt: "2026-03-29T00:20:00.000Z",
    };

    await store.put(completed);
    const loadedCompleted = await store.get(completed.runId);

    expect(loadedCompleted).toEqual(completed);
    expect(loadedCompleted?.phase).toBe("completed");
    expect(loadedCompleted?.pendingAction).toBe("none");
  });

  it("round-trips research session records in separate session directories", async () => {
    const sessionsRoot = join(tempRoot, "sessions");
    const repository = new JsonFileResearchSessionRepository(sessionsRoot);
    const original = makeResearchSession();

    await repository.saveSession(original);
    const loaded = await repository.loadSession(original.sessionId);

    expect(loaded).toEqual(researchSessionRecordSchema.parse(original));
  });

  it("loads typed research session metadata directly from persisted session files", async () => {
    const sessionsRoot = join(tempRoot, "sessions");
    const repository = new JsonFileResearchSessionRepository(sessionsRoot);
    const original = makeResearchSession({
      sessionId: "session-metadata",
      status: "halted",
      progress: {
        completedCycles: 2,
        nextCycle: 3,
        latestRunId: "run-002",
        latestDecisionId: "decision-002",
        latestFrontierIds: ["frontier-002"],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 1,
        insufficientEvidenceStreak: 0,
        lastCheckpointAt: "2026-04-12T00:05:00.000Z",
        lastSignals: {
          cycle: 2,
          outcome: "accepted",
          changedFileCount: 2,
          diffLineCount: 18,
          repeatedDiff: false,
          meaningfulProgress: true,
          insufficientEvidence: false,
          agentTieBreakerUsed: false,
          newArtifacts: ["reports/cycle-002.json"],
          reasons: ["Checkpoint 2 persisted before startup selection."],
        },
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 3,
        requiresUserConfirmation: true,
        checkpointRunId: "run-002",
        checkpointDecisionId: "decision-002",
      },
      stopCondition: {
        type: "operator_stop",
      },
    });

    await repository.saveSession(original);

    const loaded = await repository.loadSessionMetadata?.("session-metadata");
    const listed = await repository.querySessionMetadata?.({
      statuses: ["halted"],
    });

    expect(loaded).toEqual(buildResearchSessionMetadata(researchSessionRecordSchema.parse(original)));
    expect(listed).toEqual([buildResearchSessionMetadata(researchSessionRecordSchema.parse(original))]);
  });

  it("round-trips project defaults in a dedicated file outside the review session directories", async () => {
    const defaultsPath = join(tempRoot, "project-defaults.json");
    const store = new JsonFileResearchProjectDefaultsStore(defaultsPath);
    const original = makeResearchProjectDefaults();

    await store.save(original);
    const loaded = await store.load();
    const persisted = JSON.parse(await readFile(defaultsPath, "utf8"));

    expect(loaded).toEqual(researchProjectDefaultsRecordSchema.parse(original));
    expect(persisted).toEqual(researchProjectDefaultsRecordSchema.parse(original));
  });

  it("loads persisted research-session bundles with stored Codex session references for lifecycle checks", async () => {
    const sessionsRoot = join(tempRoot, "sessions");
    const repository = new JsonFileResearchSessionRepository(sessionsRoot);
    const original = makeResearchSession({ sessionId: "session-bundle" });
    const lifecycle = makeCodexCliSessionLifecycle({
      sessionId: "session-bundle",
      identity: {
        researchSessionId: "session-bundle",
        codexSessionId: "codex-session-777",
        agent: "codex_cli",
      },
    });

    await repository.saveSession(original);
    await mkdir(join(sessionsRoot, "session-bundle"), { recursive: true });
    await writeFile(
      join(sessionsRoot, "session-bundle", "codex-session.json"),
      serializeCodexCliSessionLifecycleRecord(lifecycle),
      "utf8",
    );

    const loaded = await repository.loadPersistedSession?.("session-bundle");

    expect(loaded).toMatchObject({
      session: researchSessionRecordSchema.parse(original),
      lifecycle,
      codexSessionReference: {
        codexSessionId: "codex-session-777",
        lifecyclePath: join(sessionsRoot, "session-bundle", "codex-session.json"),
      },
    });
  });

  it("updates persisted research sessions and reloads them across repository instances", async () => {
    const sessionsRoot = join(tempRoot, "sessions");
    const firstRepository = new JsonFileResearchSessionRepository(sessionsRoot);
    const secondRepository = new JsonFileResearchSessionRepository(sessionsRoot);
    const thirdRepository = new JsonFileResearchSessionRepository(sessionsRoot);

    await firstRepository.saveSession(
      makeResearchSession({
        sessionId: "session-restart-safe",
        status: "draft",
        progress: {
          completedCycles: 0,
          nextCycle: 1,
          latestFrontierIds: [],
          repeatedFailureStreak: 0,
          noMeaningfulProgressStreak: 0,
          insufficientEvidenceStreak: 0,
        },
        resume: {
          resumable: true,
          checkpointType: "completed_cycle_boundary",
          resumeFromCycle: 1,
          requiresUserConfirmation: false,
        },
      }),
    );

    const savedDraft = await secondRepository.loadSession("session-restart-safe");
    expect(savedDraft).toMatchObject({
      sessionId: "session-restart-safe",
      status: "draft",
      progress: {
        completedCycles: 0,
        nextCycle: 1,
      },
    });

    const updatedSession = researchSessionRecordSchema.parse({
      ...savedDraft!,
      status: "awaiting_resume",
      progress: {
        completedCycles: 1,
        nextCycle: 2,
        latestRunId: "run-001",
        latestDecisionId: "decision-001",
        latestFrontierIds: ["frontier-001"],
        repeatedFailureStreak: 0,
        noMeaningfulProgressStreak: 0,
        insufficientEvidenceStreak: 0,
        lastCheckpointAt: "2026-04-12T00:05:00.000Z",
        lastSignals: {
          cycle: 1,
          outcome: "accepted",
          changedFileCount: 2,
          diffLineCount: 24,
          meaningfulProgress: true,
          reasons: ["Created a reproducible verification artifact."],
        },
      },
      resume: {
        resumable: true,
        checkpointType: "completed_cycle_boundary",
        resumeFromCycle: 2,
        requiresUserConfirmation: true,
        checkpointRunId: "run-001",
        checkpointDecisionId: "decision-001",
        interruptionDetectedAt: "2026-04-12T00:06:00.000Z",
        interruptedDuringCycle: 2,
      },
      updatedAt: "2026-04-12T00:06:00.000Z",
    });

    await secondRepository.saveSession(updatedSession);

    await expect(thirdRepository.loadSession("session-restart-safe")).resolves.toEqual(updatedSession);
  });

  it("persists research sessions only in session-specific directories with session.json payloads", async () => {
    const sessionsRoot = join(tempRoot, "sessions");
    const repository = new JsonFileResearchSessionRepository(sessionsRoot);
    const original = makeResearchSession({ sessionId: "session-layout" });

    await repository.saveSession(original);

    const persistedPath = join(sessionsRoot, "session-layout", "session.json");
    const persisted = JSON.parse(await readFile(persistedPath, "utf8"));

    expect(persisted).toEqual(researchSessionRecordSchema.parse(original));
  });

  it("rejects legacy run-record payloads when loading research sessions", async () => {
    const sessionsRoot = join(tempRoot, "sessions");
    const repository = new JsonFileResearchSessionRepository(sessionsRoot);
    const legacyRunRecord = makeRunRecord({
      runId: "run-legacy",
      candidateId: "candidate-legacy",
    });
    const persistedPath = join(sessionsRoot, "session-legacy", "session.json");

    await mkdir(join(sessionsRoot, "session-legacy"), { recursive: true });
    await writeFile(persistedPath, `${JSON.stringify(legacyRunRecord, null, 2)}\n`, "utf8");

    await expect(repository.loadSession("session-legacy")).rejects.toThrow();
  });

  it("rejects legacy decision-record payloads when loading research sessions", async () => {
    const sessionsRoot = join(tempRoot, "sessions");
    const repository = new JsonFileResearchSessionRepository(sessionsRoot);
    const legacyDecisionRecord = makeDecisionRecord({
      decisionId: "decision-legacy",
      runId: "run-legacy",
    });
    const persistedPath = join(sessionsRoot, "session-legacy-decision", "session.json");

    await mkdir(join(sessionsRoot, "session-legacy-decision"), { recursive: true });
    await writeFile(persistedPath, `${JSON.stringify(legacyDecisionRecord, null, 2)}\n`, "utf8");

    await expect(repository.loadSession("session-legacy-decision")).rejects.toThrow();
  });

  it("rejects legacy frontier snapshots when loading research sessions", async () => {
    const sessionsRoot = join(tempRoot, "sessions");
    const repository = new JsonFileResearchSessionRepository(sessionsRoot);
    const legacyFrontierSnapshot = [
      makeFrontierEntry({
        frontierId: "frontier-legacy",
        runId: "run-legacy",
        candidateId: "candidate-legacy",
      }),
    ];
    const persistedPath = join(sessionsRoot, "session-legacy-frontier", "session.json");

    await mkdir(join(sessionsRoot, "session-legacy-frontier"), { recursive: true });
    await writeFile(persistedPath, `${JSON.stringify(legacyFrontierSnapshot, null, 2)}\n`, "utf8");

    await expect(repository.loadSession("session-legacy-frontier")).rejects.toThrow();
  });

  it("validates persisted research-session checkpoints when reloading after a restart", async () => {
    const sessionsRoot = join(tempRoot, "sessions");
    const repository = new JsonFileResearchSessionRepository(sessionsRoot);
    const persistedPath = join(sessionsRoot, "session-invalid", "session.json");

    await mkdir(join(sessionsRoot, "session-invalid"), { recursive: true });
    await writeFile(
      persistedPath,
      `${JSON.stringify(
        {
          ...makeResearchSession({
            sessionId: "session-invalid",
          }),
          progress: {
            completedCycles: 2,
            nextCycle: 5,
            latestRunId: "run-002",
            latestDecisionId: "decision-002",
            latestFrontierIds: ["frontier-001"],
            repeatedFailureStreak: 0,
            noMeaningfulProgressStreak: 0,
            insufficientEvidenceStreak: 0,
            lastCheckpointAt: "2026-04-12T00:10:00.000Z",
            lastSignals: {
              cycle: 2,
              outcome: "accepted",
              changedFileCount: 3,
              diffLineCount: 41,
              meaningfulProgress: true,
              reasons: ["Created a new evaluation report."],
            },
          },
          resume: {
            resumable: true,
            checkpointType: "completed_cycle_boundary",
            resumeFromCycle: 3,
            requiresUserConfirmation: true,
            checkpointRunId: "run-002",
            checkpointDecisionId: "decision-002",
            interruptionDetectedAt: "2026-04-12T00:12:00.000Z",
            interruptedDuringCycle: 3,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(repository.loadSession("session-invalid")).rejects.toThrow(
      "progress.nextCycle must advance from the last completed cycle boundary",
    );
  });

  it("queries saved research sessions in stable order", async () => {
    const sessionsRoot = join(tempRoot, "sessions");
    const repository = new JsonFileResearchSessionRepository(sessionsRoot);
    await repository.saveSession(makeResearchSession({ sessionId: "session-002" }));
    await repository.saveSession(makeResearchSession({ sessionId: "session-001" }));

    const records = await repository.querySessions();

    expect(records.map((record) => record.sessionId)).toEqual(["session-001", "session-002"]);
  });

  it("queries research sessions by working directory and status", async () => {
    const sessionsRoot = join(tempRoot, "sessions");
    const repository = new JsonFileResearchSessionRepository(sessionsRoot);
    await repository.saveSession(
      makeResearchSession({
        sessionId: "session-running",
        status: "running",
        workingDirectory: "/tmp/demo-a",
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
    await repository.saveSession(
      makeResearchSession({
        sessionId: "session-halted",
        status: "halted",
        workingDirectory: "/tmp/demo-a",
        stopCondition: {
          type: "no_meaningful_progress",
          count: 5,
          threshold: 5,
        },
      }),
    );
    await repository.saveSession(
      makeResearchSession({
        sessionId: "session-other-root",
        workingDirectory: "/tmp/demo-b",
      }),
    );

    const records = await repository.querySessions({
      workingDirectory: "/tmp/demo-a",
      statuses: ["running", "halted"],
    });

    expect(records.map((record) => record.sessionId)).toEqual([
      "session-halted",
      "session-running",
    ]);
  });

  it("ignores stray directories without a session.json payload", async () => {
    const sessionsRoot = join(tempRoot, "sessions");
    const repository = new JsonFileResearchSessionRepository(sessionsRoot);
    await repository.saveSession(makeResearchSession({ sessionId: "session-001" }));
    await mkdir(join(sessionsRoot, "scratch-space"), { recursive: true });

    const records = await repository.querySessions();

    expect(records.map((record) => record.sessionId)).toEqual(["session-001"]);
  });

  it("rejects mismatched session directory names", async () => {
    const sessionsRoot = join(tempRoot, "sessions");
    const repository = new JsonFileResearchSessionRepository(sessionsRoot);
    const original = makeResearchSession({ sessionId: "session-actual" });
    const persistedPath = join(sessionsRoot, "session-alias", "session.json");

    await mkdir(join(sessionsRoot, "session-alias"), { recursive: true });
    await writeFile(persistedPath, `${JSON.stringify(original, null, 2)}\n`, "utf8");

    await expect(repository.querySessions()).rejects.toThrow(
      'Research session directory name "session-alias" must match record sessionId "session-actual"',
    );
  });
});
