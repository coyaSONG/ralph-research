import { describe, expect, it } from "vitest";

import { loadManifestFromFile, ManifestLoadError } from "../src/adapters/fs/manifest-loader.js";

const fixturesDir = new URL("./fixtures/manifests/", import.meta.url);

describe("loadManifestFromFile", () => {
  it("loads a valid writing manifest and applies defaults", async () => {
    const loaded = await loadManifestFromFile(new URL("valid-writing.ralph.yaml", fixturesDir).pathname);

    expect(loaded.manifest.project.name).toBe("writing-demo");
    expect(loaded.manifest.project.baselineRef).toBe("main");
    expect(loaded.manifest.scope.maxFilesChanged).toBe(5);
    expect(loaded.manifest.scope.maxLineDelta).toBe(200);
    expect(loaded.manifest.storage.root).toBe(".ralph");
    expect(loaded.manifest.judgePacks[0]?.lowConfidenceThreshold).toBe(0.75);
    expect(loaded.manifest.judgePacks[0]?.anchors?.minAgreementWithHuman).toBe(0.8);
  });

  it("loads a valid code manifest", async () => {
    const loaded = await loadManifestFromFile(new URL("valid-code.ralph.yaml", fixturesDir).pathname);

    expect(loaded.manifest.project.artifact).toBe("code");
    expect(loaded.manifest.proposer.type).toBe("command");
    expect(loaded.manifest.frontier.strategy).toBe("single_best");
    expect(loaded.manifest.ratchet.type).toBe("epsilon_improve");
    expect(loaded.manifest.storage.root).toBe(".rrx");
  });

  it("rejects unsupported pareto frontier in v0.1", async () => {
    await expect(loadManifestFromFile(new URL("invalid-pareto.ralph.yaml", fixturesDir).pathname)).rejects.toMatchObject({
      name: "ManifestLoadError",
    });
  });

  it("rejects missing judge pack references", async () => {
    await expect(loadManifestFromFile(new URL("invalid-missing-judge-pack.ralph.yaml", fixturesDir).pathname)).rejects.toBeInstanceOf(ManifestLoadError);
  });

  it("rejects unknown ratchet metric references", async () => {
    await expect(loadManifestFromFile(new URL("invalid-ratchet-metric.ralph.yaml", fixturesDir).pathname)).rejects.toBeInstanceOf(ManifestLoadError);
  });
});
