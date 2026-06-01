import { describe, expect, it } from "vitest";

import { assertProjectTransition } from "./project-state";

describe("assertProjectTransition", () => {
  it("allows draft projects to become recruiting", () => {
    expect(() => assertProjectTransition("draft", "recruiting")).not.toThrow();
  });

  it("rejects illegal direct settlement transitions", () => {
    expect(() => assertProjectTransition("draft", "settling")).toThrow(
      "Illegal project status transition: draft -> settling",
    );
  });
});
