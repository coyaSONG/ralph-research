import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

mkdirSync(join(process.cwd(), "out"), { recursive: true });

const result = spawnSync(
  process.execPath,
  ["--test", "--test-reporter=tap", "tests/calculator.test.mjs"],
  {
    cwd: process.cwd(),
    encoding: "utf8",
  },
);

const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const passMatch = combined.match(/# pass (\d+)/);
const failMatch = combined.match(/# fail (\d+)/);

const passed = passMatch ? Number(passMatch[1]) : 0;
const failed = failMatch ? Number(failMatch[1]) : 0;

writeFileSync(
  join(process.cwd(), "out", "test-results.json"),
  `${JSON.stringify({ passed, failed }, null, 2)}\n`,
  "utf8",
);

console.log("experiment complete");
