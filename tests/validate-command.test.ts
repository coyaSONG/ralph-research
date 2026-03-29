import { describe, expect, it } from "vitest";

import { runValidateCommand } from "../src/cli/commands/validate.js";

const fixturesDir = new URL("./fixtures/manifests/", import.meta.url);

function createBufferedIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    io: {
      stdout: (message: string) => {
        stdout.push(message);
      },
      stderr: (message: string) => {
        stderr.push(message);
      },
    },
    stdout,
    stderr,
  };
}

describe("runValidateCommand", () => {
  it("prints success output for a valid manifest", async () => {
    const buffer = createBufferedIo();
    const exitCode = await runValidateCommand(
      {
        path: new URL("valid-writing.ralph.yaml", fixturesDir).pathname,
        json: false,
      },
      buffer.io,
    );

    expect(exitCode).toBe(0);
    expect(buffer.stdout[0]).toContain("Manifest is valid:");
    expect(buffer.stderr).toHaveLength(0);
  });

  it("prints json error output for an invalid manifest", async () => {
    const buffer = createBufferedIo();
    const exitCode = await runValidateCommand(
      {
        path: new URL("invalid-pareto.ralph.yaml", fixturesDir).pathname,
        json: true,
      },
      buffer.io,
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(buffer.stderr[0] ?? "{}")).toMatchObject({
      ok: false,
    });
  });
});
