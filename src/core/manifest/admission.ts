import { execa } from "execa";

import type { LeafProposerConfig, RalphManifest } from "./schema.js";

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
