import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonFileDecisionStore } from "../src/adapters/fs/json-file-decision-store.js";
import { JsonFileFrontierStore } from "../src/adapters/fs/json-file-frontier-store.js";
import { JsonFileRunStore } from "../src/adapters/fs/json-file-run-store.js";
import type { DecisionRecord } from "../src/core/model/decision-record.js";
import type { FrontierEntry } from "../src/core/model/frontier-entry.js";
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
});
