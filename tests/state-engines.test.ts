import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonFileRunStore } from "../src/adapters/fs/json-file-run-store.js";
import { evaluateConstraints } from "../src/core/state/constraint-engine.js";
import {
  compareParetoFrontier,
  compareSingleBestFrontier,
  updateParetoFrontier,
  updateSingleBestFrontier,
} from "../src/core/state/frontier-engine.js";
import { classifyRecovery } from "../src/core/state/recovery-classifier.js";
import { evaluateRatchet } from "../src/core/state/ratchet-engine.js";
import { advanceRunPhase, canResume, recoverRun } from "../src/core/state/run-state-machine.js";
import type { DecisionRecord } from "../src/core/model/decision-record.js";
import type { FrontierEntry } from "../src/core/model/frontier-entry.js";
import type { MetricResult } from "../src/core/model/metric.js";
import type { RunRecord } from "../src/core/model/run-record.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-state-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function makeMetric(metricId: string, value: number, direction: "maximize" | "minimize", confidence?: number): MetricResult {
  return {
    metricId,
    value,
    direction,
    confidence,
    details: {},
  };
}

function makeFrontierEntry(frontierId: string, metric: MetricResult): FrontierEntry {
  return {
    frontierId,
    runId: `run-${frontierId}`,
    candidateId: `candidate-${frontierId}`,
    acceptedAt: "2026-03-29T00:00:00.000Z",
    commitSha: "abc123",
    metrics: {
      [metric.metricId]: metric,
    },
    artifacts: [
      {
        id: "artifact",
        path: `/tmp/${frontierId}.txt`,
      },
    ],
  };
}

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-001",
    cycle: 1,
    candidateId: "candidate-001",
    status: "running",
    phase: "proposed",
    pendingAction: "execute_experiment",
    startedAt: "2026-03-29T00:00:00.000Z",
    manifestHash: "manifest-hash",
    workspaceRef: "main",
    workspacePath: "/tmp/workspace",
    proposal: {
      proposerType: "command",
      summary: "Generated a bounded patch.",
      operators: ["operator-a"],
      patchPath: "/tmp/patch.diff",
      diffLines: 3,
      withinBudget: true,
    },
    artifacts: [
      {
        id: "artifact",
        path: "/tmp/artifact.txt",
      },
    ],
    metrics: {},
    constraints: [],
    logs: {},
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
    metricId: "quality",
    reason: "accepted by test",
    createdAt: "2026-03-29T00:00:00.000Z",
    frontierChanged: true,
    beforeFrontierIds: [],
    afterFrontierIds: ["frontier-run-001"],
    auditRequired: false,
    ...overrides,
  };
}

describe("frontier-engine", () => {
  it("accepts candidate when frontier is empty", () => {
    const candidate = makeFrontierEntry("frontier-001", makeMetric("quality", 0.9, "maximize"));

    const comparison = compareSingleBestFrontier([], candidate, "quality");

    expect(comparison.frontierChanged).toBe(true);
    expect(comparison.outcome).toBe("accepted");
  });

  it("replaces incumbent when maximize metric improves", () => {
    const incumbent = makeFrontierEntry("frontier-000", makeMetric("quality", 0.7, "maximize"));
    const candidate = makeFrontierEntry("frontier-001", makeMetric("quality", 0.9, "maximize"));

    const result = updateSingleBestFrontier([incumbent], candidate, "quality");

    expect(result.entries).toEqual([candidate]);
    expect(result.comparison.delta).toBeCloseTo(0.2);
  });

  it("keeps incumbent when maximize metric is equal", () => {
    const incumbent = makeFrontierEntry("frontier-000", makeMetric("quality", 0.8, "maximize"));
    const candidate = makeFrontierEntry("frontier-001", makeMetric("quality", 0.8, "maximize"));

    const result = updateSingleBestFrontier([incumbent], candidate, "quality");

    expect(result.entries).toEqual([incumbent]);
    expect(result.comparison.outcome).toBe("rejected");
  });

  it("keeps incumbent when maximize metric regresses", () => {
    const incumbent = makeFrontierEntry("frontier-000", makeMetric("quality", 0.8, "maximize"));
    const candidate = makeFrontierEntry("frontier-001", makeMetric("quality", 0.6, "maximize"));

    const result = updateSingleBestFrontier([incumbent], candidate, "quality");

    expect(result.entries).toEqual([incumbent]);
    expect(result.comparison.delta).toBeCloseTo(-0.2);
  });

  it("replaces incumbent when minimize metric improves", () => {
    const incumbent = makeFrontierEntry("frontier-000", makeMetric("latency", 150, "minimize"));
    const candidate = makeFrontierEntry("frontier-001", makeMetric("latency", 120, "minimize"));

    const result = updateSingleBestFrontier([incumbent], candidate, "latency");

    expect(result.entries).toEqual([candidate]);
    expect(result.comparison.delta).toBeCloseTo(30);
  });

  it("keeps incumbent when minimize metric gets worse", () => {
    const incumbent = makeFrontierEntry("frontier-000", makeMetric("latency", 100, "minimize"));
    const candidate = makeFrontierEntry("frontier-001", makeMetric("latency", 120, "minimize"));

    const result = updateSingleBestFrontier([incumbent], candidate, "latency");

    expect(result.entries).toEqual([incumbent]);
    expect(result.comparison.outcome).toBe("rejected");
  });

  it("throws when single_best frontier contains multiple entries", () => {
    const incumbentA = makeFrontierEntry("frontier-000", makeMetric("quality", 0.7, "maximize"));
    const incumbentB = makeFrontierEntry("frontier-001", makeMetric("quality", 0.8, "maximize"));
    const candidate = makeFrontierEntry("frontier-002", makeMetric("quality", 0.9, "maximize"));

    expect(() => updateSingleBestFrontier([incumbentA, incumbentB], candidate, "quality")).toThrow(
      "single_best frontier expected at most one entry",
    );
  });

  it("throws when the candidate is missing the primary metric", () => {
    const incumbent = makeFrontierEntry("frontier-000", makeMetric("quality", 0.7, "maximize"));
    const candidate = {
      ...makeFrontierEntry("frontier-001", makeMetric("other_metric", 0.9, "maximize")),
      metrics: {
        other_metric: makeMetric("other_metric", 0.9, "maximize"),
      },
    };

    expect(() => compareSingleBestFrontier([incumbent], candidate, "quality")).toThrow(
      'missing primary metric "quality"',
    );
  });

  it("accepts a non-dominated candidate into a pareto frontier", () => {
    const incumbent = makeFrontierEntry("frontier-000", makeMetric("quality", 0.8, "maximize"));
    incumbent.metrics.latency = makeMetric("latency", 150, "minimize");
    const candidate = makeFrontierEntry("frontier-001", makeMetric("quality", 0.75, "maximize"));
    candidate.metrics.latency = makeMetric("latency", 120, "minimize");

    const result = updateParetoFrontier(
      [incumbent],
      candidate,
      [
        { metric: "quality", epsilon: 0 },
        { metric: "latency", epsilon: 0 },
      ],
      "hypervolume",
    );

    expect(result.comparison.outcome).toBe("accepted");
    expect(result.entries).toHaveLength(2);
  });

  it("rejects a pareto candidate when an incumbent dominates it", () => {
    const incumbent = makeFrontierEntry("frontier-000", makeMetric("quality", 0.9, "maximize"));
    incumbent.metrics.latency = makeMetric("latency", 100, "minimize");
    const candidate = makeFrontierEntry("frontier-001", makeMetric("quality", 0.8, "maximize"));
    candidate.metrics.latency = makeMetric("latency", 120, "minimize");

    const comparison = compareParetoFrontier(
      [incumbent],
      candidate,
      [
        { metric: "quality", epsilon: 0 },
        { metric: "latency", epsilon: 0 },
      ],
    );

    expect(comparison.outcome).toBe("rejected");
    expect(comparison.reason).toContain("pareto-dominated");
  });

  it("removes dominated incumbents when updating a pareto frontier", () => {
    const incumbentA = makeFrontierEntry("frontier-000", makeMetric("quality", 0.7, "maximize"));
    incumbentA.metrics.latency = makeMetric("latency", 130, "minimize");
    const incumbentB = makeFrontierEntry("frontier-001", makeMetric("quality", 0.8, "maximize"));
    incumbentB.metrics.latency = makeMetric("latency", 140, "minimize");
    const candidate = makeFrontierEntry("frontier-002", makeMetric("quality", 0.82, "maximize"));
    candidate.metrics.latency = makeMetric("latency", 120, "minimize");

    const result = updateParetoFrontier(
      [incumbentA, incumbentB],
      candidate,
      [
        { metric: "quality", epsilon: 0 },
        { metric: "latency", epsilon: 0 },
      ],
      "hypervolume",
      {
        quality: 0,
        latency: 200,
      },
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.frontierId).toBe("frontier-002");
  });
});

describe("constraint-engine", () => {
  it("passes when all hard constraints are satisfied", () => {
    const summary = evaluateConstraints(
      [{ metric: "factuality", op: ">=", value: 0.9 }],
      { factuality: makeMetric("factuality", 0.95, "maximize") },
    );

    expect(summary.passed).toBe(true);
    expect(summary.reason).toBe("all constraints satisfied");
  });

  it("fails when a hard constraint is violated", () => {
    const summary = evaluateConstraints(
      [{ metric: "lint_errors", op: "<=", value: 0 }],
      { lint_errors: makeMetric("lint_errors", 2, "minimize") },
    );

    expect(summary.passed).toBe(false);
    expect(summary.results[0]?.passed).toBe(false);
    expect(summary.reason).toContain("constraint lint_errors failed");
  });
});

describe("ratchet-engine", () => {
  it("accepts epsilon_improve when improvement exceeds epsilon", () => {
    const decision = evaluateRatchet({
      ratchet: { type: "epsilon_improve", metric: "quality", epsilon: 0.05 },
      primaryMetric: "quality",
      candidateMetrics: { quality: makeMetric("quality", 0.9, "maximize") },
      currentFrontier: [makeFrontierEntry("frontier-000", makeMetric("quality", 0.8, "maximize"))],
    });

    expect(decision.outcome).toBe("accepted");
    expect(decision.frontierChanged).toBe(true);
  });

  it("routes approval_gate to needs_human when confidence is below threshold", () => {
    const decision = evaluateRatchet({
      ratchet: { type: "approval_gate", metric: "quality", minConfidence: 0.8 },
      primaryMetric: "quality",
      candidateMetrics: { quality: makeMetric("quality", 0.9, "maximize", 0.6) },
      currentFrontier: [makeFrontierEntry("frontier-000", makeMetric("quality", 0.8, "maximize", 0.9))],
    });

    expect(decision.outcome).toBe("needs_human");
    expect(decision.reason).toContain("below threshold");
  });

  it("records a graduation event when approval_gate reaches the consecutive accept threshold", () => {
    const decision = evaluateRatchet({
      ratchet: {
        type: "approval_gate",
        metric: "quality",
        minConfidence: 0.8,
        graduation: {
          consecutiveAccepts: 2,
          epsilon: 0.05,
        },
      },
      primaryMetric: "quality",
      candidateMetrics: { quality: makeMetric("quality", 0.9, "maximize", 0.95) },
      currentFrontier: [makeFrontierEntry("frontier-000", makeMetric("quality", 0.8, "maximize", 0.9))],
      priorConsecutiveAccepts: 1,
    });

    expect(decision.outcome).toBe("accepted");
    expect(decision.policyType).toBe("approval_gate");
    expect(decision.graduation).toMatchObject({
      activatedPolicy: "epsilon_improve",
      consecutiveAccepts: 2,
      epsilon: 0.05,
    });
  });

  it("switches approval_gate to epsilon_improve after graduation is unlocked", () => {
    const decision = evaluateRatchet({
      ratchet: {
        type: "approval_gate",
        metric: "quality",
        minConfidence: 0.8,
        graduation: {
          consecutiveAccepts: 2,
          epsilon: 0.05,
        },
      },
      primaryMetric: "quality",
      candidateMetrics: { quality: makeMetric("quality", 0.86, "maximize", 0.4) },
      currentFrontier: [makeFrontierEntry("frontier-000", makeMetric("quality", 0.8, "maximize", 0.95))],
      priorConsecutiveAccepts: 2,
    });

    expect(decision.outcome).toBe("accepted");
    expect(decision.policyType).toBe("epsilon_improve");
    expect(decision.reason).toContain("graduated autonomy active");
  });

  it("accepts a non-dominated candidate with pareto_dominance", () => {
    const decision = evaluateRatchet({
      ratchet: { type: "pareto_dominance" },
      primaryMetric: "quality",
      paretoObjectives: [
        { metric: "quality", epsilon: 0 },
        { metric: "latency", epsilon: 0 },
      ],
      candidateMetrics: {
        quality: makeMetric("quality", 0.75, "maximize"),
        latency: makeMetric("latency", 100, "minimize"),
      },
      currentFrontier: [
        {
          ...makeFrontierEntry("frontier-000", makeMetric("quality", 0.8, "maximize")),
          metrics: {
            quality: makeMetric("quality", 0.8, "maximize"),
            latency: makeMetric("latency", 120, "minimize"),
          },
        },
      ],
    });

    expect(decision.outcome).toBe("accepted");
    expect(decision.policyType).toBe("pareto_dominance");
  });
});

describe("run-state-machine", () => {
  it("classifies the absence of a latest run as idle", () => {
    expect(classifyRecovery({ latestRun: null })).toMatchObject({
      classification: "idle",
      nextAction: "none",
      resumeAllowed: false,
    });
  });

  it("classifies a replay-safe latest checkpoint as resumable", () => {
    const latestRun = makeRunRecord({
      phase: "proposed",
      pendingAction: "execute_experiment",
    });

    expect(classifyRecovery({ latestRun })).toMatchObject({
      classification: "resumable",
      nextAction: "execute_experiment",
      resumeAllowed: true,
    });
  });

  it("classifies needs_human runs as manual_review_blocked", () => {
    const latestRun = makeRunRecord({
      phase: "decision_written",
      status: "needs_human",
      decisionId: "decision-001",
      pendingAction: "none",
    });

    expect(classifyRecovery({ latestRun, decision: makeDecisionRecord({ outcome: "needs_human" }) })).toMatchObject({
      classification: "manual_review_blocked",
      nextAction: "none",
      resumeAllowed: false,
    });
  });

  it("classifies accepted decision checkpoints without a durable patch as repair_required", () => {
    const { patchPath: _ignored, ...proposalWithoutPatch } = makeRunRecord().proposal;
    const latestRun = makeRunRecord({
      phase: "decision_written",
      status: "accepted",
      decisionId: "decision-001",
      pendingAction: "commit_candidate",
      proposal: proposalWithoutPatch,
    });

    expect(classifyRecovery({ latestRun, decision: makeDecisionRecord() })).toMatchObject({
      classification: "repair_required",
      nextAction: "none",
      resumeAllowed: false,
    });
  });

  it("classifies contradictory accepted-path evidence as repair_required", () => {
    const latestRun = makeRunRecord({
      phase: "committed",
      status: "accepted",
      decisionId: "decision-001",
      pendingAction: "update_frontier",
    });
    const decision = makeDecisionRecord({
      commitSha: "abc123",
    });
    const frontier = [
      makeFrontierEntry("frontier-run-001", makeMetric("quality", 0.9, "maximize")),
    ];
    frontier[0] = {
      ...frontier[0]!,
      runId: latestRun.runId,
      candidateId: latestRun.candidateId,
    };

    expect(classifyRecovery({ latestRun, decision, frontier })).toMatchObject({
      classification: "repair_required",
      resumeAllowed: false,
    });
  });

  it("advances phases idempotently without regressing", () => {
    const run = makeRunRecord();
    const executed = advanceRunPhase(run, "executed");
    const executedAgain = advanceRunPhase(executed, "executed");
    const regressed = advanceRunPhase(executedAgain, "proposed");

    expect(executed.phase).toBe("executed");
    expect(executed.pendingAction).toBe("evaluate_metrics");
    expect(executedAgain).toEqual(executed);
    expect(regressed).toEqual(executed);
  });

  it("recovers a run interrupted after decision_written by resuming commit_candidate", async () => {
    const store = new JsonFileRunStore(join(tempRoot, "runs"));
    const decisionWritten = advanceRunPhase(
      makeRunRecord({
        phase: "evaluated",
        status: "accepted",
        pendingAction: "write_decision",
      }),
      "decision_written",
      {
        status: "accepted",
        decisionId: "decision-001",
      },
    );

    await store.put(decisionWritten);
    const loaded = await store.get(decisionWritten.runId);

    expect(loaded).not.toBeNull();
    expect(canResume(loaded!)).toBe(true);
    expect(recoverRun(loaded!)).toMatchObject({
      resumable: true,
      nextAction: "commit_candidate",
    });
  });

  it("recovers a run interrupted after committed by resuming frontier update", async () => {
    const store = new JsonFileRunStore(join(tempRoot, "runs"));
    const committed = advanceRunPhase(
      makeRunRecord({
        phase: "decision_written",
        status: "accepted",
        decisionId: "decision-001",
        pendingAction: "commit_candidate",
      }),
      "committed",
      {
        status: "accepted",
      },
    );

    await store.put(committed);
    const loaded = await store.get(committed.runId);

    expect(loaded).not.toBeNull();
    expect(canResume(loaded!)).toBe(true);
    expect(recoverRun(loaded!)).toMatchObject({
      resumable: true,
      nextAction: "update_frontier",
    });
  });
});
