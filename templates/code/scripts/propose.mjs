import { writeFileSync } from "node:fs";
import { join } from "node:path";

const fixedCalculator = `export function sum(a, b) {
  return a + b;
}

export function multiply(a, b) {
  return a * b;
}
`;

writeFileSync(join(process.cwd(), "src", "calculator.mjs"), fixedCalculator, "utf8");
console.log("proposal complete");
