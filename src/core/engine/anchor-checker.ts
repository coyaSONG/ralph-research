import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import type { JudgePack, LlmJudgeMetricExtractorConfig } from "../manifest/schema.js";
import type { JudgeProvider, JudgeWinner } from "../../adapters/judge/llm-judge-provider.js";
import { evaluateJudgePack } from "./judge-pack.js";

const anchorRecordSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  expectedWinner: z.enum(["candidate", "incumbent", "tie"]),
});

export type AnchorRecord = z.infer<typeof anchorRecordSchema>;

export interface AnchorCheckResult {
  checked: boolean;
  passed: boolean;
  agreement: number;
  minAgreement: number;
  autoAcceptAllowed: boolean;
  reason: string;
  sampleCount: number;
}

export interface EvaluateAnchorAgreementInput {
  pack: JudgePack;
  extractor: LlmJudgeMetricExtractorConfig;
  provider: JudgeProvider;
  anchors?: AnchorRecord[];
}

export async function loadAnchorRecords(path: string): Promise<AnchorRecord[]> {
  const raw = await readFile(resolve(path), "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => anchorRecordSchema.parse(JSON.parse(line)));
}

export async function evaluateAnchorAgreement(input: EvaluateAnchorAgreementInput): Promise<AnchorCheckResult> {
  const anchors = input.anchors ?? [];
  const minAgreement = input.pack.anchors?.minAgreementWithHuman ?? 0;

  if (!input.pack.anchors || anchors.length === 0) {
    return {
      checked: false,
      passed: true,
      agreement: 1,
      minAgreement,
      autoAcceptAllowed: true,
      reason: "no anchors configured",
      sampleCount: 0,
    };
  }

  let agreed = 0;
  for (const anchor of anchors) {
    const samples = [];
    for (let repeat = 0; repeat < input.pack.repeats; repeat += 1) {
      for (const judge of input.pack.judges) {
        samples.push(
          await input.provider.evaluate({
            mode: input.extractor.mode,
            prompt: anchor.prompt,
            model: judge.model,
          }),
        );
      }
    }

    const aggregation = evaluateJudgePack({ pack: input.pack, samples });
    const winner = aggregation.mode === "pairwise" ? aggregation.winner : aggregation.score >= 0.5 ? "candidate" : "incumbent";
    if (winner === anchor.expectedWinner) {
      agreed += 1;
    }
  }

  const sampleCount = anchors.length;
  const agreement = sampleCount === 0 ? 1 : agreed / sampleCount;
  const passed = agreement >= minAgreement;
  const autoAcceptAllowed = passed || !input.pack.audit.freezeAutoAcceptIfAnchorFails;

  return {
    checked: true,
    passed,
    agreement,
    minAgreement,
    autoAcceptAllowed,
    reason: passed
      ? `anchor agreement ${agreement.toFixed(2)} passed threshold ${minAgreement.toFixed(2)}`
      : `anchor agreement ${agreement.toFixed(2)} below threshold ${minAgreement.toFixed(2)}`,
    sampleCount,
  };
}

export function applyAnchorAgreementGate(
  tentativeOutcome: "accepted" | "rejected" | "needs_human",
  anchorCheck: AnchorCheckResult,
): { outcome: "accepted" | "rejected" | "needs_human"; reason: string } {
  if (tentativeOutcome !== "accepted") {
    return {
      outcome: tentativeOutcome,
      reason: anchorCheck.reason,
    };
  }

  if (!anchorCheck.autoAcceptAllowed) {
    return {
      outcome: "needs_human",
      reason: `${anchorCheck.reason}; auto-accept disabled`,
    };
  }

  return {
    outcome: tentativeOutcome,
    reason: anchorCheck.reason,
  };
}
