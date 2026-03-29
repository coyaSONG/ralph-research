import { execaCommand } from "execa";

export type JudgeMode = "absolute" | "pairwise";
export type JudgeWinner = "candidate" | "incumbent" | "tie";
export type JudgeBackend = "codex_exec" | "claude_p";

export interface JudgeRequest {
  mode: JudgeMode;
  prompt: string;
  model: string;
}

export interface PairwiseJudgeResponse {
  mode: "pairwise";
  winner: JudgeWinner;
  confidence?: number;
  rationale: string;
  raw: string;
}

export interface AbsoluteJudgeResponse {
  mode: "absolute";
  score: number;
  confidence?: number;
  rationale: string;
  raw: string;
}

export type JudgeResponse = PairwiseJudgeResponse | AbsoluteJudgeResponse;

export interface JudgeProvider {
  evaluate(request: JudgeRequest): Promise<JudgeResponse>;
}

export interface CliJudgeProviderOptions {
  backend: JudgeBackend;
  command?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export function createCliJudgeProvider(options: CliJudgeProviderOptions): JudgeProvider {
  return {
    async evaluate(request: JudgeRequest): Promise<JudgeResponse> {
      const command = buildCommand(options, request);
      const result = await execaCommand(command, {
        shell: true,
        env: { ...process.env, ...options.env },
        input: request.prompt,
        reject: false,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });

      if (result.exitCode !== 0) {
        throw new Error(`judge provider command failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`);
      }

      return parseJudgeResponse(request.mode, result.stdout);
    },
  };
}

function buildCommand(options: CliJudgeProviderOptions, request: JudgeRequest): string {
  if (options.command) {
    return options.command;
  }

  switch (options.backend) {
    case "codex_exec":
      return `codex exec --skip-git-repo-check --quiet ${shellQuote(
        `You are judging with model ${request.model}. Return JSON only.`,
      )}`;
    case "claude_p":
      return `claude -p ${shellQuote(`You are judging with model ${request.model}. Return JSON only.`)}`;
  }
}

function parseJudgeResponse(mode: JudgeMode, stdout: string): JudgeResponse {
  const parsed = extractJsonObject(stdout);
  if (mode === "pairwise") {
    const winner = normalizeWinner(parsed.winner);
    const confidence = normalizeConfidence(parsed.confidence);
    return {
      mode,
      winner,
      rationale: String(parsed.rationale ?? ""),
      raw: stdout,
      ...(confidence === undefined ? {} : { confidence }),
    };
  }

  const score = Number(parsed.score);
  if (!Number.isFinite(score)) {
    throw new Error("absolute judge response must include a finite numeric score");
  }

  const confidence = normalizeConfidence(parsed.confidence);

  return {
    mode,
    score,
    rationale: String(parsed.rationale ?? ""),
    raw: stdout,
    ...(confidence === undefined ? {} : { confidence }),
  };
}

function extractJsonObject(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("judge provider did not return parseable JSON");
    }
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

function normalizeWinner(value: unknown): JudgeWinner {
  if (value === "candidate" || value === "incumbent" || value === "tie") {
    return value;
  }
  throw new Error(`pairwise judge response must include a valid winner, received ${String(value)}`);
}

function normalizeConfidence(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`judge confidence must be between 0 and 1, received ${String(value)}`);
  }

  return confidence;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
