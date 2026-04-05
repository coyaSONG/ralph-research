import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { RalphManifest } from "../manifest/schema.js";
import type { RunRecord } from "../model/run-record.js";
import { GitWorktreeWorkspaceManager } from "./workspace-manager.js";

export async function preparePromotionArtifact(input: {
  candidateId: string;
  runDir: string;
  manifest: RalphManifest;
  workspaceManager: GitWorktreeWorkspaceManager;
}): Promise<{
  patchPath: string;
  changedPaths: string[];
}> {
  const bundle = await input.workspaceManager.preparePromotionBundle(input.candidateId, {
    excludePaths: input.manifest.experiment.outputs.map((output) => output.path),
  });
  if (bundle.changedPaths.length === 0) {
    throw new Error(`accepted run ${input.candidateId} is missing durable changed-path metadata`);
  }

  return {
    patchPath: await persistText(
      join(input.runDir, "promotion", `${input.candidateId}.patch`),
      bundle.patch,
    ),
    changedPaths: bundle.changedPaths,
  };
}

export async function ensurePromotionArtifact(input: {
  run: RunRecord;
  runDir: string;
  manifest: RalphManifest;
  workspaceManager: GitWorktreeWorkspaceManager;
}): Promise<{
  patchPath: string;
  changedPaths: string[];
}> {
  const existingPatchPath = input.run.proposal.patchPath;
  const existingChangedPaths = input.run.proposal.changedPaths?.filter(Boolean) ?? [];

  if (existingPatchPath && existingChangedPaths.length > 0 && await pathExists(existingPatchPath)) {
    return {
      patchPath: existingPatchPath,
      changedPaths: existingChangedPaths,
    };
  }

  return preparePromotionArtifact({
    candidateId: input.run.candidateId,
    runDir: input.runDir,
    manifest: input.manifest,
    workspaceManager: input.workspaceManager,
  });
}

export function requirePromotionPatch(run: RunRecord): string {
  if (!run.proposal.patchPath) {
    throw new Error(`run ${run.runId} is missing a durable promotion patch`);
  }

  return run.proposal.patchPath;
}

export function requirePromotionPaths(run: RunRecord): string[] {
  const changedPaths = run.proposal.changedPaths?.filter(Boolean) ?? [];
  if (changedPaths.length === 0) {
    throw new Error(`run ${run.runId} is missing durable promotion paths`);
  }

  return changedPaths;
}

async function persistText(path: string, value: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
  return path;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
