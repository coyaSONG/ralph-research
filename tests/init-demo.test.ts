import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadManifestFromFile } from "../src/adapters/fs/manifest-loader.js";
import { runDemoCommand, SUPPORTED_DEMO_TEMPLATES } from "../src/cli/commands/demo.js";
import { runInitCommand } from "../src/cli/commands/init.js";
import { createProgram } from "../src/cli/program.js";

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
    expect(payload.template).toBe("writing");
    expect(payload.status).toBe("accepted");
    expect(payload.runId).toBe("run-0001");
    expect(typeof payload.inspect.decisionReason).toBe("string");
    expect(payload.inspect.decisionReason.length).toBeGreaterThan(0);
    expect(await readFile(join(targetDir, "docs", "draft.md"), "utf8")).toContain("measurable loop");
  });

  it("runs the zero-config code demo end to end", async () => {
    const targetDir = join(tempRoot, "code-demo-project");
    const io = createCapturingIo();
    const exitCode = await runDemoCommand(
      "code",
      {
        path: targetDir,
        json: true,
      },
      io,
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(io.stdoutText());
    expect(payload.ok).toBe(true);
    expect(payload.template).toBe("code");
    expect(payload.status).toBe("accepted");
    expect(payload.runId).toBe("run-0001");
    expect(typeof payload.inspect.decisionReason).toBe("string");
    expect(payload.inspect.decisionReason.length).toBeGreaterThan(0);
    expect(await readFile(join(targetDir, "src", "calculator.mjs"), "utf8")).toContain(
      "return a + b",
    );
  });

  it("advertises every supported template name in the demo command help text", () => {
    const program = createProgram();
    const demo = program.commands.find((cmd) => cmd.name() === "demo");
    expect(demo, "createProgram should register a 'demo' subcommand").toBeDefined();
    const help = demo!.helpInformation();
    for (const template of SUPPORTED_DEMO_TEMPLATES) {
      expect(help, `demo --help must mention template '${template}'`).toContain(template);
    }
  });

  it("rejects an unsupported demo template name with a JSON error", async () => {
    const io = createCapturingIo();
    const exitCode = await runDemoCommand(
      "unknown-template",
      {
        path: join(tempRoot, "rejected-project"),
        json: true,
      },
      io,
    );

    expect(exitCode).toBe(1);
    const payload = JSON.parse(io.stderrText());
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("Unsupported demo template unknown-template");
    expect(payload.error).toContain("writing");
    expect(payload.error).toContain("code");
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
