import { readFileSync } from "node:fs";
import { join } from "node:path";

const results = JSON.parse(
  readFileSync(join(process.cwd(), "out", "test-results.json"), "utf8"),
);

console.log(Number(results.passed ?? 0));
