import { execa } from "execa";

import type { LeafProposerConfig, RalphManifest } from "./schema.js";

const COMMAND_ONLY_PROPOSER_KEYS = ["command", "cwd", "env", "timeoutSec"] as const;

export interface ManifestAdmissionIssue {
  code: "unsupported_capability";
  path: Array<string | number>;
  message: string;
}

export interface ManifestAdmissionContext {
  repoRoot?: string;
  resolveGitRef?: (repoRoot: string, ref: string) => Promise<string | null>;
}

export interface ManifestAdmissionResult {
  executable: boolean;
  issues: ManifestAdmissionIssue[];
  resolvedBaselineRef: string;
}

export function compileRawManifestAdmission(rawManifest: unknown): ManifestAdmissionIssue[] {
  const issues: ManifestAdmissionIssue[] = [];

  if (!isRecord(rawManifest)) {
    return issues;
  }

  collectRawProposerIssues(rawManifest.proposer, ["proposer"], issues);
  return issues;
}

export async function compileManifestAdmission(
  manifest: RalphManifest,
  context: ManifestAdmissionContext = {},
): Promise<ManifestAdmissionResult> {
  const issues: ManifestAdmissionIssue[] = [];

  if (manifest.project.workspace !== "git") {
    issues.push({
      code: "unsupported_capability",
      path: ["project", "workspace"],
      message: `project.workspace="${manifest.project.workspace}" is unsupported; use "git"`,
    });
  }

  collectProposerIssues(manifest.proposer, ["proposer"], issues);

  let resolvedBaselineRef = manifest.project.baselineRef;
  if (context.repoRoot) {
    const resolveGitRef = context.resolveGitRef ?? defaultResolveGitRef;
    const resolvedCommit = await resolveGitRef(context.repoRoot, manifest.project.baselineRef);
    if (!resolvedCommit) {
      issues.push({
        code: "unsupported_capability",
        path: ["project", "baselineRef"],
        message: `project.baselineRef="${manifest.project.baselineRef}" could not be resolved to a commit in the target repository`,
      });
    } else {
      resolvedBaselineRef = resolvedCommit;
    }
  }

  return {
    executable: issues.length === 0,
    issues,
    resolvedBaselineRef,
  };
}

function collectProposerIssues(
  proposer: RalphManifest["proposer"] | LeafProposerConfig,
  path: Array<string | number>,
  issues: ManifestAdmissionIssue[],
): void {
  if (proposer.type === "command") {
    return;
  }

  if (proposer.type === "codex_cli") {
    issues.push({
      code: "unsupported_capability",
      path: [...path, "type"],
      message: `${formatPath(path)}.type="${proposer.type}" is not executable yet; the TUI session orchestrator is required`,
    });
    return;
  }

  if (proposer.type === "operator_llm") {
    issues.push({
      code: "unsupported_capability",
      path: [...path, "type"],
      message: `${formatPath(path)}.type="${proposer.type}" is unsupported; use a command proposer`,
    });
    return;
  }

  for (const [index, strategy] of proposer.strategies.entries()) {
    collectProposerIssues(strategy, [...path, "strategies", index], issues);
  }
}

function collectRawProposerIssues(
  proposer: unknown,
  path: Array<string | number>,
  issues: ManifestAdmissionIssue[],
): void {
  if (!isRecord(proposer) || typeof proposer.type !== "string") {
    return;
  }

  if (proposer.type === "codex_cli") {
    if (!("ttySession" in proposer)) {
      issues.push({
        code: "unsupported_capability",
        path: [...path, "ttySession"],
        message: `${formatPath(path)}.ttySession is required when ${formatPath(path)}.type="codex_cli"`,
      });
    }

    for (const key of COMMAND_ONLY_PROPOSER_KEYS) {
      if (key in proposer) {
        issues.push({
          code: "unsupported_capability",
          path: [...path, key],
          message: `${formatPath(path)}.${key} is unsupported when ${formatPath(path)}.type="codex_cli"; use ttySession for interactive agent settings`,
        });
      }
    }

    return;
  }

  if (proposer.type !== "parallel" || !Array.isArray(proposer.strategies)) {
    return;
  }

  for (const [index, strategy] of proposer.strategies.entries()) {
    collectRawProposerIssues(strategy, [...path, "strategies", index], issues);
  }
}

async function defaultResolveGitRef(repoRoot: string, ref: string): Promise<string | null> {
  try {
    const { stdout } = await execa("git", ["-C", repoRoot, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    const resolvedRef = stdout.trim();
    return resolvedRef.length > 0 ? resolvedRef : null;
  } catch {
    return null;
  }
}

function formatPath(path: Array<string | number>): string {
  return path
    .map((segment, index) => (typeof segment === "number" ? `[${segment}]` : index === 0 ? segment : `.${segment}`))
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
