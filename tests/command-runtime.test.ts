import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extractCommandMetric } from "../src/adapters/extractor/command-extractor.js";
import { runCommandProposer } from "../src/adapters/proposer/command-proposer.js";
import { runExperiment } from "../src/core/engine/experiment-runner.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-command-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("command runtime adapters", () => {
  it("runs the command proposer inside the candidate workspace", async () => {
    const workspacePath = join(tempRoot, "workspace");
    await mkdir(workspacePath, { recursive: true });

    const scriptPath = join(tempRoot, "propose.mjs");
    await writeFile(
      scriptPath,
      [
        'import { writeFileSync } from "node:fs";',
        'import { join } from "node:path";',
        'writeFileSync(join(process.cwd(), "candidate.md"), "candidate draft\\n", "utf8");',
        'console.log("proposal complete");',
      ].join("\n"),
      "utf8",
    );

    const result = await runCommandProposer(
      {
        type: "command",
        command: `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`,
        env: {},
        timeoutSec: 10,
      },
      { workspacePath },
    );

    expect(result.proposerType).toBe("command");
    expect(result.stdout).toContain("proposal complete");
    expect(await readFile(join(workspacePath, "candidate.md"), "utf8")).toBe("candidate draft\n");
  });

  it("runs the experiment command inside the candidate workspace", async () => {
    const workspacePath = join(tempRoot, "workspace");
    await mkdir(workspacePath, { recursive: true });

    const scriptPath = join(tempRoot, "experiment.mjs");
    await writeFile(
      scriptPath,
      [
        'import { writeFileSync } from "node:fs";',
        'import { join } from "node:path";',
        'writeFileSync(join(process.cwd(), "out.txt"), "experiment result\\n", "utf8");',
        'console.log("experiment complete");',
      ].join("\n"),
      "utf8",
    );

    const result = await runExperiment(
      {
        command: `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`,
        env: {},
        timeoutSec: 10,
      },
      { workspacePath },
    );

    expect(result.stdout).toContain("experiment complete");
    expect(await readFile(join(workspacePath, "out.txt"), "utf8")).toBe("experiment result\n");
  });

  it("extracts numeric metrics via plain_number, regex, and json_path parsers", async () => {
    const workspacePath = join(tempRoot, "workspace");
    await mkdir(workspacePath, { recursive: true });

    const plainScript = join(tempRoot, "plain.mjs");
    await writeFile(plainScript, 'console.log("42.5");\n', "utf8");

    const regexScript = join(tempRoot, "regex.mjs");
    await writeFile(regexScript, 'console.log("score=7.25");\n', "utf8");

    const jsonScript = join(tempRoot, "json.mjs");
    await writeFile(jsonScript, 'console.log(JSON.stringify({ metrics: { score: 9 } }));\n', "utf8");

    const plainMetric = await extractCommandMetric(
      {
        type: "command",
        command: `${JSON.stringify(process.execPath)} ${JSON.stringify(plainScript)}`,
        env: {},
        timeoutSec: 10,
        parser: "plain_number",
      },
      { metricId: "plain", direction: "maximize", workspacePath },
    );

    const regexMetric = await extractCommandMetric(
      {
        type: "command",
        command: `${JSON.stringify(process.execPath)} ${JSON.stringify(regexScript)}`,
        env: {},
        timeoutSec: 10,
        parser: "regex",
        pattern: "score=(?<value>[0-9.]+)",
      },
      { metricId: "regex", direction: "maximize", workspacePath },
    );

    const jsonMetric = await extractCommandMetric(
      {
        type: "command",
        command: `${JSON.stringify(process.execPath)} ${JSON.stringify(jsonScript)}`,
        env: {},
        timeoutSec: 10,
        parser: "json_path",
        valuePath: "$.metrics.score",
      },
      { metricId: "json", direction: "maximize", workspacePath },
    );

    expect(plainMetric.value).toBeCloseTo(42.5);
    expect(regexMetric.value).toBeCloseTo(7.25);
    expect(jsonMetric.value).toBe(9);
  });
});
