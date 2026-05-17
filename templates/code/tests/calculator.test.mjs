import { test } from "node:test";
import { strict as assert } from "node:assert";

import { multiply, sum } from "../src/calculator.mjs";

test("sum adds two positive integers", () => {
  assert.equal(sum(2, 3), 5);
});

test("sum handles a zero operand", () => {
  assert.equal(sum(0, 7), 7);
});

test("multiply multiplies two positive integers", () => {
  assert.equal(multiply(3, 4), 12);
});

test("multiply by one is identity", () => {
  assert.equal(multiply(1, 9), 9);
});
