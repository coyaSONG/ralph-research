import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "yaml";
import { ZodError } from "zod";

import { DEFAULT_MANIFEST_FILENAME, RalphManifestSchema, type RalphManifest } from "../../core/manifest/schema.js";

export interface LoadedManifest {
  path: string;
  manifest: RalphManifest;
}

export class ManifestLoadError extends Error {
  public readonly causeValue?: unknown;

  public constructor(message: string, causeValue?: unknown) {
    super(message);
    this.name = "ManifestLoadError";
    this.causeValue = causeValue;
  }
}

export async function loadManifestFromFile(path = DEFAULT_MANIFEST_FILENAME): Promise<LoadedManifest> {
  const resolvedPath = resolve(path);

  let rawText: string;
  try {
    rawText = await readFile(resolvedPath, "utf8");
  } catch (error) {
    throw new ManifestLoadError(`Failed to read manifest at ${resolvedPath}`, error);
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = parse(rawText);
  } catch (error) {
    throw new ManifestLoadError(`Failed to parse YAML from ${resolvedPath}`, error);
  }

  try {
    return {
      path: resolvedPath,
      manifest: RalphManifestSchema.parse(parsedYaml),
    };
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ManifestLoadError(`Manifest validation failed for ${resolvedPath}`, error.flatten());
    }

    throw new ManifestLoadError(`Manifest validation failed for ${resolvedPath}`, error);
  }
}
