import { resolve } from "node:path";

import { loadManifestFromFile, ManifestLoadError } from "../../adapters/fs/manifest-loader.js";
import { DEFAULT_MANIFEST_FILENAME } from "../../core/manifest/schema.js";

export interface RunAdmissionInput {
  repoRoot: string;
  manifestPath?: string;
}

export interface RunAdmissionSuccess {
  ok: true;
  executable: true;
  path: string;
  project: string;
  schemaVersion: string;
}

export interface RunAdmissionFailure {
  ok: false;
  executable: false;
  path: string;
  error: string;
  details?: unknown;
}

export type RunAdmissionResult = RunAdmissionSuccess | RunAdmissionFailure;

export async function getRunAdmission(input: RunAdmissionInput): Promise<RunAdmissionResult> {
  const repoRoot = resolve(input.repoRoot);
  const manifestPath = resolve(repoRoot, input.manifestPath ?? DEFAULT_MANIFEST_FILENAME);

  try {
    const loadedManifest = await loadManifestFromFile(manifestPath, { repoRoot });
    return {
      ok: true,
      executable: true,
      path: loadedManifest.path,
      project: loadedManifest.manifest.project.name,
      schemaVersion: loadedManifest.manifest.schemaVersion,
    };
  } catch (error) {
    if (error instanceof ManifestLoadError) {
      return {
        ok: false,
        executable: false,
        path: manifestPath,
        error: error.message,
        ...(error.causeValue === undefined ? {} : { details: error.causeValue }),
      };
    }

    throw error;
  }
}
