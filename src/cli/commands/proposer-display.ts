import type { RunRecord } from "../../core/model/run-record.js";

export function formatProposalDisplayLines(
  proposal: RunRecord["proposal"],
  label: string,
): string[] {
  const lines = [`${label}: ${proposal.proposerType}`];
  const metadata = proposal.adapterMetadata;

  if (metadata?.adapter === "codex_cli") {
    lines.push(
      `${label} invocation: session ${metadata.invocation.sessionId} via ${formatCommand(
        metadata.invocation.command,
        metadata.invocation.args,
      )}`,
    );
    lines.push(`${label} outcome: ${formatCodexCliOutcome(metadata.outcome)}`);
  }

  return lines;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function formatCodexCliOutcome(
  outcome: Extract<NonNullable<RunRecord["proposal"]["adapterMetadata"]>, { adapter: "codex_cli" }>["outcome"],
): string {
  const exitCode = outcome.code ?? "null";
  const signal = outcome.signal ?? "none";
  return `${outcome.kind} code=${exitCode} signal=${signal} duration=${outcome.durationMs}ms`;
}
