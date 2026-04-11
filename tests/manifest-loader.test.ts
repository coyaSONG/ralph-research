import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

import { loadManifestFromFile, ManifestLoadError } from "../src/adapters/fs/manifest-loader.js";

const fixturesDir = new URL("./fixtures/manifests/", import.meta.url);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (tempDir) => rm(tempDir, { recursive: true, force: true })));
});

describe("loadManifestFromFile", () => {
  it("loads a valid writing manifest and applies defaults", async () => {
    const loaded = await loadManifestFromFile(new URL("valid-writing.ralph.yaml", fixturesDir).pathname);

    expect(loaded.manifest.project.name).toBe("writing-demo");
    expect(loaded.manifest.project.baselineRef).toBe("main");
    expect(loaded.manifest.scope.maxFilesChanged).toBe(5);
    expect(loaded.manifest.scope.maxLineDelta).toBe(200);
    expect(loaded.manifest.storage.root).toBe(".ralph");
    expect(loaded.manifest.storage.researchSession).toEqual({
      sessionsDir: "sessions",
      projectDefaultsFile: "project-defaults.json",
    });
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

  it("loads a valid pareto manifest", async () => {
    const loaded = await loadManifestFromFile(new URL("valid-pareto.ralph.yaml", fixturesDir).pathname);

    expect(loaded.manifest.frontier.strategy).toBe("pareto");
    expect(loaded.manifest.frontier.objectives).toHaveLength(2);
    expect(loaded.manifest.ratchet.type).toBe("pareto_dominance");
  });

  it("loads a manifest with a stopping target", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ralph-research-manifest-"));
    tempDirs.push(tempDir);
    const manifestPath = join(tempDir, "target.ralph.yaml");
    await writeFile(
      manifestPath,
      [
        'schemaVersion: "0.1"',
        "project:",
        "  name: stopping-target",
        "  artifact: code",
        "proposer:",
        "  type: command",
        "  command: ./scripts/propose.sh",
        "experiment:",
        "  run:",
        "    command: ./scripts/run.sh",
        "metrics:",
        "  catalog:",
        "    - id: quality",
        "      kind: numeric",
        "      direction: maximize",
        "      extractor:",
        "        type: command",
        "        command: ./scripts/metric.sh",
        "        parser: plain_number",
        "frontier:",
        "  strategy: single_best",
        "  primaryMetric: quality",
        "ratchet:",
        "  type: epsilon_improve",
        "  metric: quality",
        "  epsilon: 0",
        "stopping:",
        "  target:",
        "    op: \">=\"",
        "    value: 0.8",
      ].join("\n"),
      "utf8",
    );

    const loaded = await loadManifestFromFile(manifestPath);
    expect(loaded.manifest.stopping.target).toMatchObject({
      op: ">=",
      value: 0.8,
    });
  });

  it("rejects invalid pareto frontier combinations", async () => {
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

  it("rejects unknown stopping target metric references", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ralph-research-manifest-"));
    tempDirs.push(tempDir);
    const manifestPath = join(tempDir, "invalid-target.ralph.yaml");
    await writeFile(
      manifestPath,
      [
        'schemaVersion: "0.1"',
        "project:",
        "  name: invalid-stopping-target",
        "  artifact: code",
        "proposer:",
        "  type: command",
        "  command: ./scripts/propose.sh",
        "experiment:",
        "  run:",
        "    command: ./scripts/run.sh",
        "metrics:",
        "  catalog:",
        "    - id: quality",
        "      kind: numeric",
        "      direction: maximize",
        "      extractor:",
        "        type: command",
        "        command: ./scripts/metric.sh",
        "        parser: plain_number",
        "frontier:",
        "  strategy: single_best",
        "  primaryMetric: quality",
        "ratchet:",
        "  type: epsilon_improve",
        "  metric: quality",
        "  epsilon: 0",
        "stopping:",
        "  target:",
        "    metric: missing_metric",
        "    op: \">=\"",
        "    value: 0.8",
      ].join("\n"),
      "utf8",
    );

    await expect(loadManifestFromFile(manifestPath)).rejects.toBeInstanceOf(ManifestLoadError);
  });

  it("rejects unsupported workspace declarations with admission details", async () => {
    await expect(loadManifestFromFile(new URL("invalid-unsupported-workspace.ralph.yaml", fixturesDir).pathname)).rejects.toMatchObject({
      name: "ManifestLoadError",
      causeValue: {
        executable: false,
        issues: [
          expect.objectContaining({
            code: "unsupported_capability",
            path: ["project", "workspace"],
          }),
        ],
      },
    });
  });

  it("rejects unsupported operator proposers with admission details", async () => {
    await expect(loadManifestFromFile(new URL("invalid-unsupported-operator-llm.ralph.yaml", fixturesDir).pathname)).rejects.toMatchObject({
      name: "ManifestLoadError",
      causeValue: {
        executable: false,
        issues: [
          expect.objectContaining({
            code: "unsupported_capability",
            path: ["proposer", "type"],
          }),
        ],
      },
    });
  });

  it("rejects codex_cli fixtures that omit ttySession with admission details", async () => {
    await expect(loadManifestFromFile(new URL("invalid-codex-cli-missing-tty-session.ralph.yaml", fixturesDir).pathname)).rejects.toMatchObject({
      name: "ManifestLoadError",
      causeValue: {
        executable: false,
        issues: [
          expect.objectContaining({
            code: "unsupported_capability",
            path: ["proposer", "ttySession"],
          }),
        ],
      },
    });
  });

  it("rejects codex_cli fixtures that mix command-only proposer fields with admission details", async () => {
    await expect(loadManifestFromFile(new URL("invalid-codex-cli-command-only-fields.ralph.yaml", fixturesDir).pathname)).rejects.toMatchObject({
      name: "ManifestLoadError",
      causeValue: {
        executable: false,
        issues: [
          expect.objectContaining({
            code: "unsupported_capability",
            path: ["proposer", "command"],
          }),
          expect.objectContaining({
            code: "unsupported_capability",
            path: ["proposer", "cwd"],
          }),
          expect.objectContaining({
            code: "unsupported_capability",
            path: ["proposer", "env"],
          }),
          expect.objectContaining({
            code: "unsupported_capability",
            path: ["proposer", "timeoutSec"],
          }),
        ],
      },
    });
  });

  it("rejects unresolved baseline refs when repo context is available", async () => {
    const repoRoot = await initTempRepo();
    const manifestPath = join(repoRoot, "ralph.yaml");
    await writeFile(
      manifestPath,
      [
        'schemaVersion: "0.1"',
        "project:",
        "  name: baseline-check",
        "  artifact: code",
        "  baselineRef: does-not-exist",
        "proposer:",
        "  type: command",
        "  command: ./scripts/propose.sh",
        "experiment:",
        "  run:",
        "    command: ./scripts/run.sh",
        "metrics:",
        "  catalog:",
        "    - id: quality",
        "      kind: numeric",
        "      direction: maximize",
        "      extractor:",
        "        type: command",
        "        command: ./scripts/metric.sh",
        "        parser: plain_number",
        "frontier:",
        "  strategy: single_best",
        "  primaryMetric: quality",
        "ratchet:",
        "  type: epsilon_improve",
        "  metric: quality",
        "  epsilon: 0",
      ].join("\n"),
      "utf8",
    );

    await expect(loadManifestFromFile(manifestPath, { repoRoot })).rejects.toMatchObject({
      name: "ManifestLoadError",
      causeValue: {
        executable: false,
        issues: [
          expect.objectContaining({
            code: "unsupported_capability",
            path: ["project", "baselineRef"],
          }),
        ],
      },
    });
  });

  it("keeps parallel command strategies admissible", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ralph-research-manifest-"));
    tempDirs.push(tempDir);
    const manifestPath = join(tempDir, "parallel.ralph.yaml");
    await writeFile(
      manifestPath,
      [
        'schemaVersion: "0.1"',
        "project:",
        "  name: parallel-valid",
        "  artifact: code",
        "proposer:",
        "  type: parallel",
        "  pickBest: highest_metric",
        "  strategies:",
        "    - type: command",
        "      command: ./scripts/propose-a.sh",
        "    - type: command",
        "      command: ./scripts/propose-b.sh",
        "experiment:",
        "  run:",
        "    command: ./scripts/run.sh",
        "metrics:",
        "  catalog:",
        "    - id: quality",
        "      kind: numeric",
        "      direction: maximize",
        "      extractor:",
        "        type: command",
        "        command: ./scripts/metric.sh",
        "        parser: plain_number",
        "frontier:",
        "  strategy: single_best",
        "  primaryMetric: quality",
        "ratchet:",
        "  type: epsilon_improve",
        "  metric: quality",
        "  epsilon: 0",
      ].join("\n"),
      "utf8",
    );

    const loaded = await loadManifestFromFile(manifestPath);
    expect(loaded.manifest.proposer.type).toBe("parallel");
    expect(loaded.manifest.proposer.strategies).toHaveLength(2);
  });
});

async function initTempRepo(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "ralph-research-manifest-repo-"));
  tempDirs.push(repoRoot);
  await execa("git", ["init"], { cwd: repoRoot });
  await execa("git", ["config", "user.name", "ralph-research"], { cwd: repoRoot });
  await execa("git", ["config", "user.email", "rrx@example.invalid"], { cwd: repoRoot });
  await writeFile(join(repoRoot, "README.md"), "fixture\n", "utf8");
  await execa("git", ["add", "README.md"], { cwd: repoRoot });
  await execa("git", ["commit", "-m", "fixture"], { cwd: repoRoot });
  await execa("git", ["branch", "-M", "main"], { cwd: repoRoot });
  return repoRoot;
}
