import { describe, expect, it } from "vitest";

import { extractLlmJudgeMetric } from "../src/adapters/extractor/llm-judge-extractor.js";
import type { JudgeProvider, JudgeRequest, JudgeResponse } from "../src/adapters/judge/llm-judge-provider.js";
import { applyAnchorAgreementGate, evaluateAnchorAgreement, type AnchorRecord } from "../src/core/engine/anchor-checker.js";
import { sampleAuditQueue } from "../src/core/engine/audit-sampler.js";
import { evaluateJudgePack } from "../src/core/engine/judge-pack.js";
import { evaluateRatchet } from "../src/core/state/ratchet-engine.js";

describe("trusted signal guardrails", () => {
  it("aggregates pairwise votes with majority vote and confidence", () => {
    const aggregation = evaluateJudgePack({
      pack: makeJudgePack({ repeats: 5, lowConfidenceThreshold: 0.75 }),
      samples: [
        pairwise("candidate", 1),
        pairwise("candidate", 1),
        pairwise("candidate", 1),
        pairwise("incumbent", 1),
        pairwise("incumbent", 1),
      ],
    });

    expect(aggregation.mode).toBe("pairwise");
    if (aggregation.mode !== "pairwise") {
      throw new Error("expected pairwise aggregation");
    }

    expect(aggregation.winner).toBe("candidate");
    expect(aggregation.voteCounts).toEqual({
      candidate: 3,
      incumbent: 2,
      tie: 0,
    });
    expect(aggregation.candidateScore).toBeCloseTo(0.6);
    expect(aggregation.confidence).toBeCloseTo(0.8);
    expect(aggregation.needsHuman).toBe(false);
  });

  it("routes low-confidence pairwise wins to needs_human through approval_gate", async () => {
    const provider = createFakeJudgeProvider([
      pairwise("candidate", 0.2),
      pairwise("candidate", 0.3),
      pairwise("candidate", 0.4),
      pairwise("incumbent", 0.3),
      pairwise("incumbent", 0.4),
    ]);

    const metric = await extractLlmJudgeMetric(
      {
        type: "llm_judge",
        judgePack: "writing-pack",
        prompt: "judge_prompt.md",
        mode: "pairwise",
        compareAgainst: "frontier.best",
        inputs: {},
        outputKey: "score",
      },
      makeJudgePack({ repeats: 5, lowConfidenceThreshold: 0.75 }),
      {
        metricId: "paper_quality",
        direction: "maximize",
        prompt: "compare candidate and incumbent",
      },
      provider,
    );

    const decision = evaluateRatchet({
      ratchet: { type: "approval_gate", metric: "paper_quality", minConfidence: 0.75 },
      primaryMetric: "paper_quality",
      candidateMetrics: { paper_quality: metric },
      currentFrontier: [
        {
          frontierId: "frontier-001",
          runId: "run-001",
          candidateId: "candidate-001",
          acceptedAt: "2026-03-29T00:00:00.000Z",
          metrics: {
            paper_quality: {
              metricId: "paper_quality",
              value: 0.5,
              direction: "maximize",
              confidence: 0.95,
              details: {},
            },
          },
          artifacts: [],
        },
      ],
    });

    expect(metric.value).toBeCloseTo(0.6);
    expect(metric.confidence).toBeCloseTo(0.46);
    expect(metric.details.needsHuman).toBe(true);
    expect(decision.outcome).toBe("needs_human");
    expect(decision.reason).toContain("below threshold");
  });

  it("disables auto-accept when anchor agreement falls below threshold", async () => {
    const anchors: AnchorRecord[] = [
      {
        id: "anchor-1",
        prompt: "anchor one",
        expectedWinner: "candidate",
      },
      {
        id: "anchor-2",
        prompt: "anchor two",
        expectedWinner: "candidate",
      },
    ];

    const provider = createPromptMappedJudgeProvider({
      "anchor one": [pairwise("candidate", 0.9)],
      "anchor two": [pairwise("incumbent", 0.9)],
    });

    const anchorCheck = await evaluateAnchorAgreement({
      pack: makeJudgePack({
        repeats: 1,
        anchors: {
          path: "anchors.jsonl",
          minAgreementWithHuman: 0.8,
        },
        audit: {
          sampleRate: 0.1,
          freezeAutoAcceptIfAnchorFails: true,
        },
      }),
      extractor: {
        type: "llm_judge",
        judgePack: "writing-pack",
        prompt: "judge_prompt.md",
        mode: "pairwise",
        compareAgainst: "frontier.best",
        inputs: {},
        outputKey: "score",
      },
      provider,
      anchors,
    });

    const gated = applyAnchorAgreementGate("accepted", anchorCheck);

    expect(anchorCheck.checked).toBe(true);
    expect(anchorCheck.agreement).toBe(0.5);
    expect(anchorCheck.autoAcceptAllowed).toBe(false);
    expect(gated.outcome).toBe("needs_human");
    expect(gated.reason).toContain("auto-accept disabled");
  });

  it("creates an audit queue from accepted/rejected decisions using sample rate", () => {
    const queue = sampleAuditQueue(
      [
        { runId: "run-a", outcome: "accepted", metricId: "paper_quality", reason: "accepted", decisionId: "decision-a" },
        { runId: "run-b", outcome: "rejected", metricId: "paper_quality", reason: "rejected", decisionId: "decision-b" },
        { runId: "run-c", outcome: "needs_human", metricId: "paper_quality", reason: "manual", decisionId: "decision-c" },
      ],
      {
        audit: {
          sampleRate: 1,
          freezeAutoAcceptIfAnchorFails: true,
        },
      },
      "2026-03-29T01:00:00.000Z",
    );

    expect(queue).toHaveLength(2);
    expect(queue.map((item) => item.runId)).toEqual(["run-a", "run-b"]);
    expect(queue[0]?.auditId).toBe("audit-run-a");
  });
});

function makeJudgePack(overrides: Partial<ReturnType<typeof baseJudgePack>> = {}) {
  return {
    ...baseJudgePack(),
    ...overrides,
    anchors: overrides.anchors ?? baseJudgePack().anchors,
    audit: overrides.audit ?? baseJudgePack().audit,
  };
}

function baseJudgePack() {
  return {
    id: "writing-pack",
    mode: "pairwise" as const,
    blindPairwise: true,
    orderRandomized: true,
    repeats: 3,
    aggregation: "majority_vote" as const,
    judges: [{ model: "fake-model", weight: 1 }],
    lowConfidenceThreshold: 0.75,
    anchors: {
      path: "anchors.jsonl",
      minAgreementWithHuman: 0.8,
    },
    audit: {
      sampleRate: 0.1,
      freezeAutoAcceptIfAnchorFails: true,
    },
  };
}

function pairwise(winner: "candidate" | "incumbent" | "tie", confidence?: number): JudgeResponse {
  return {
    mode: "pairwise",
    winner,
    confidence,
    rationale: `${winner} wins`,
    raw: JSON.stringify({ winner, confidence }),
  };
}

function createFakeJudgeProvider(responses: JudgeResponse[]): JudgeProvider {
  let index = 0;

  return {
    async evaluate(_request: JudgeRequest): Promise<JudgeResponse> {
      const response = responses[index];
      index += 1;
      if (!response) {
        throw new Error("fake judge provider exhausted");
      }
      return response;
    },
  };
}

function createPromptMappedJudgeProvider(responseMap: Record<string, JudgeResponse[]>): JudgeProvider {
  const positions = new Map<string, number>();

  return {
    async evaluate(request: JudgeRequest): Promise<JudgeResponse> {
      const responses = responseMap[request.prompt];
      if (!responses || responses.length === 0) {
        throw new Error(`no fake responses configured for prompt ${request.prompt}`);
      }

      const index = positions.get(request.prompt) ?? 0;
      const response = responses[index] ?? responses.at(-1);
      positions.set(request.prompt, index + 1);

      if (!response) {
        throw new Error(`no response available for prompt ${request.prompt}`);
      }

      return response;
    },
  };
}
