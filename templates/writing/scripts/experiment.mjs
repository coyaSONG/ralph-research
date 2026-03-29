import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

mkdirSync(join(process.cwd(), "out"), { recursive: true });
cpSync(join(process.cwd(), "docs", "draft.md"), join(process.cwd(), "out", "draft.md"));
console.log("experiment complete");
