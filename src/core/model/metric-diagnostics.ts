import type { MetricResult } from "./metric.js";

export interface MetricDiagnosticSummary {
  sourceMetricId?: string;
  reasons: string[];
}

export function summarizeMetricDiagnostics(metric: MetricResult): MetricDiagnosticSummary | null {
  const reasons = collectStringList(
    metric.details.reason,
    metric.details.reasons,
    metric.details.invalidReason,
    metric.details.invalidReasons,
    metric.details.flags,
    metric.details.diagnostics,
  );
  const sourceMetricId = resolveSourceMetricId(metric);

  if (!sourceMetricId && reasons.length === 0) {
    return null;
  }

  return {
    ...(sourceMetricId ? { sourceMetricId } : {}),
    reasons,
  };
}

export function appendMetricDiagnostics(reason: string, metric: MetricResult): string {
  const diagnostics = summarizeMetricDiagnostics(metric);
  if (!diagnostics) {
    return reason;
  }

  const suffixes: string[] = [];
  if (diagnostics.sourceMetricId && diagnostics.sourceMetricId !== metric.metricId) {
    suffixes.push(`source_metric=${diagnostics.sourceMetricId}`);
  }
  if (diagnostics.reasons.length > 0) {
    suffixes.push(`diagnostics=${diagnostics.reasons.join(",")}`);
  }

  if (suffixes.length === 0) {
    return reason;
  }

  return `${reason}; ${suffixes.join("; ")}`;
}

function resolveSourceMetricId(metric: MetricResult): string | undefined {
  const candidate = metric.details.sourceMetricId ?? metric.details.metricId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function collectStringList(...values: unknown[]): string[] {
  const results = new Set<string>();

  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      results.add(value);
      continue;
    }

    if (!Array.isArray(value)) {
      continue;
    }

    for (const entry of value) {
      if (typeof entry === "string" && entry.length > 0) {
        results.add(entry);
      }
    }
  }

  return [...results];
}
