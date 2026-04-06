import { resolve } from "node:path";

import { execaCommand } from "execa";

import type { CommandMetricExtractorConfig } from "../../core/manifest/schema.js";
import type { MetricResult } from "../../core/model/metric.js";

export interface ExtractCommandMetricInput {
  metricId: string;
  direction: "maximize" | "minimize";
  workspacePath: string;
  env?: Record<string, string>;
}

export async function extractCommandMetric(
  config: CommandMetricExtractorConfig,
  input: ExtractCommandMetricInput,
): Promise<MetricResult> {
  const cwd = config.cwd ? resolve(input.workspacePath, config.cwd) : resolve(input.workspacePath);
  const result = await execaCommand(config.command, {
    cwd,
    env: { ...process.env, ...config.env, ...input.env },
    reject: false,
    shell: true,
    timeout: config.timeoutSec * 1_000,
  });

  if (result.exitCode !== 0) {
    throw new Error(`command metric extractor failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`);
  }

  const parsedMetric = parseMetricValue(result.stdout, config);

  return {
    metricId: input.metricId,
    direction: input.direction,
    value: parsedMetric.value,
    details: {
      parser: config.parser,
      command: config.command,
      cwd,
      ...(parsedMetric.details ? parsedMetric.details : {}),
    },
  };
}

function parseMetricValue(
  stdout: string,
  config: CommandMetricExtractorConfig,
): {
  value: number;
  details?: Record<string, unknown>;
} {
  switch (config.parser) {
    case "plain_number":
      return {
        value: parseNumericValue(stdout.trim(), "plain_number"),
      };
    case "regex":
      return {
        value: parseRegexValue(stdout, config.pattern),
      };
    case "json_path":
      return parseJsonPathValue(stdout, config.valuePath);
  }
}

function parseRegexValue(stdout: string, pattern?: string): number {
  if (!pattern) {
    throw new Error('command metric extractor with parser="regex" requires a pattern');
  }

  const match = new RegExp(pattern, "m").exec(stdout);
  if (!match) {
    throw new Error(`regex parser did not match pattern ${pattern}`);
  }

  const candidate = match.groups?.value ?? match[1] ?? match[0];
  return parseNumericValue(candidate, "regex");
}

function parseJsonPathValue(
  stdout: string,
  valuePath?: string,
): {
  value: number;
  details?: Record<string, unknown>;
} {
  if (!valuePath) {
    throw new Error('command metric extractor with parser="json_path" requires a valuePath');
  }

  const json = JSON.parse(stdout) as unknown;
  const value = readJsonPath(json, valuePath);
  const details = extractJsonMetricDetails(json);

  return {
    value: parseNumericValue(value, "json_path"),
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}

function readJsonPath(root: unknown, path: string): unknown {
  if (!path.startsWith("$")) {
    throw new Error(`unsupported JSONPath: ${path}`);
  }

  const tokens = path
    .slice(1)
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);

  let current: unknown = root;
  for (const token of tokens) {
    if (current === null || current === undefined) {
      throw new Error(`JSONPath ${path} resolved to undefined at token ${token}`);
    }

    if (Array.isArray(current)) {
      const index = Number.parseInt(token, 10);
      current = current[index];
      continue;
    }

    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[token];
      continue;
    }

    throw new Error(`JSONPath ${path} could not descend into non-object value at token ${token}`);
  }

  return current;
}

function parseNumericValue(value: unknown, parserName: string): number {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value.trim())
        : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    throw new Error(`${parserName} parser did not resolve to a finite number`);
  }

  return numericValue;
}

function extractJsonMetricDetails(root: unknown): Record<string, unknown> {
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return {};
  }

  const record = root as Record<string, unknown>;
  const details: Record<string, unknown> = {};

  if (typeof record.reason === "string") {
    details.reason = record.reason;
  }
  if (Array.isArray(record.reasons)) {
    details.reasons = record.reasons.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof record.metricId === "string") {
    details.sourceMetricId = record.metricId;
  }
  if (typeof record.sourceMetricId === "string") {
    details.sourceMetricId = record.sourceMetricId;
  }
  if (Array.isArray(record.invalidReasons)) {
    details.invalidReasons = record.invalidReasons.filter((entry): entry is string => typeof entry === "string");
  }
  if (Array.isArray(record.flags)) {
    details.flags = record.flags.filter((entry): entry is string => typeof entry === "string");
  }
  if (Array.isArray(record.diagnostics)) {
    details.diagnostics = record.diagnostics.filter((entry): entry is string => typeof entry === "string");
  }
  if (record.details && typeof record.details === "object" && !Array.isArray(record.details)) {
    Object.assign(details, record.details);
  }

  return details;
}
