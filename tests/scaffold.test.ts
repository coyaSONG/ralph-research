import { describe, expect, it } from "vitest";

import { createAppContext } from "../src/app/context.js";

describe("createAppContext", () => {
  it("returns the scaffold context", () => {
    expect(createAppContext()).toEqual({
      appName: "research-ratchet",
      phase: "scaffold",
    });
  });
});
