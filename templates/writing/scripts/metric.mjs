import { readFileSync } from "node:fs";
import { join } from "node:path";

const draft = readFileSync(join(process.cwd(), "out", "draft.md"), "utf8").toLowerCase();

let score = 0;

if (draft.includes("metric")) {
  score += 0.3;
}
if (draft.includes("bounded experiment")) {
  score += 0.3;
}
if (draft.includes("verified to be better")) {
  score += 0.2;
}
if (draft.includes("claim and the evidence")) {
  score += 0.1;
}
if (!draft.includes("it is important")) {
  score += 0.1;
}

console.log(score.toFixed(2));
