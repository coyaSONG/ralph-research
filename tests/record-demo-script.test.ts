import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = resolve(repoRoot, "scripts/record-demo.sh");

describe("scripts/record-demo.sh", () => {
  it("is checked in as an executable file", async () => {
    const info = await stat(scriptPath);
    expect(info.isFile(), "record-demo.sh must be a file").toBe(true);
    expect(info.mode & 0o111, "record-demo.sh must be executable").not.toBe(0);
  });

  it("passes bash -n syntax check", async () => {
    await expect(execFileAsync("bash", ["-n", scriptPath])).resolves.toMatchObject({
      stdout: expect.any(String),
    });
  });

  it("runs the bundled code demo and points readers at the persisted decision evidence", async () => {
    const source = await readFile(scriptPath, "utf8");
    expect(source).toContain("ralph-research demo code");
    expect(source).toContain(".ralph/runs/run-0001/");
    expect(source).toContain(".ralph/runs/run-0001/decision.json");
    expect(source).toMatch(/set -euo pipefail/);
    expect(source).toMatch(/trap '.+' EXIT/);
  });
});
