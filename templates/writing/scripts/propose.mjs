import { writeFileSync } from "node:fs";
import { join } from "node:path";

const improvedDraft = [
  "ralph-research improves a draft through a measurable loop.",
  "",
  "The loop defines a metric, runs one bounded experiment, and keeps the result only when the revision is verified to be better.",
  "",
  "For writing workflows, that means clearer structure, tighter wording, and a more explicit connection between the claim and the evidence.",
].join("\n");

writeFileSync(join(process.cwd(), "docs", "draft.md"), improvedDraft, "utf8");
console.log("proposal complete");
