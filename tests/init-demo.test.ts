import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadManifestFromFile } from "../src/adapters/fs/manifest-loader.js";
import { runDemoCommand } from "../src/cli/commands/demo.js";
import { runInitCommand } from "../src/cli/commands/init.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-init-demo-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("init and demo commands", () => {
  it("copies the writing template and leaves a valid manifest in place", async () => {
    const targetDir = join(tempRoot, "writing-project");
    await mkdir(targetDir, { recursive: true });

    const io = createCapturingIo();
    const exitCode = await runInitCommand(
      {
        template: "writing",
        path: targetDir,
        json: true,
      },
      io,
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(io.stdoutText());
    expect(payload.ok).toBe(true);
    expect(payload.copiedFiles).toContain("ralph.yaml");
    expect(payload.initializedGit).toBe(true);
    expect(await readFile(join(targetDir, "prompts", "judge.md"), "utf8")).toContain("Return JSON only");

    const manifest = await loadManifestFromFile(join(targetDir, "ralph.yaml"));
    expect(manifest.manifest.project.name).toBe("writing-demo");
    const { stdout: headSha } = await execa("git", ["rev-parse", "HEAD"], { cwd: targetDir });
    expect(headSha.trim().length).toBeGreaterThan(0);
  });

  it("runs the zero-config writing demo end to end", async () => {
    const targetDir = join(tempRoot, "demo-project");
    const io = createCapturingIo();
    const exitCode = await runDemoCommand(
      "writing",
      {
        path: targetDir,
        json: true,
      },
      io,
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(io.stdoutText());
    expect(payload.ok).toBe(true);
    expect(payload.status).toBe("accepted");
    expect(payload.runId).toBe("run-0001");
    expect(typeof payload.inspect.decisionReason).toBe("string");
    expect(payload.inspect.decisionReason.length).toBeGreaterThan(0);
    expect(await readFile(join(targetDir, "docs", "draft.md"), "utf8")).toContain("measurable loop");
  });
});

function createCapturingIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout: (message: string) => {
      stdout.push(message);
    },
    stderr: (message: string) => {
      stderr.push(message);
    },
    stdoutText: () => stdout.join("\n"),
    stderrText: () => stderr.join("\n"),
  };
}
