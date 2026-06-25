import { describe, expect, it } from "vitest";

import {
  assertProjectTransition,
  getAllowedProjectStatusTransitions,
} from "./project-state";

describe("assertProjectTransition", () => {
  it("allows draft projects to become recruiting", () => {
    expect(() => assertProjectTransition("draft", "recruiting")).not.toThrow();
  });

  it("rejects illegal direct settlement transitions", () => {
    expect(() => assertProjectTransition("draft", "settling")).toThrow(
      "Illegal project status transition: draft -> settling",
    );
  });

  it("allows recruiting projects to become active", () => {
    expect(() => assertProjectTransition("recruiting", "active")).not.toThrow();
  });

  it("rejects active projects entering settlement directly", () => {
    expect(() => assertProjectTransition("active", "settling")).toThrow(
      "Illegal project status transition: active -> settling",
    );
  });

  it("exposes only legal next statuses for active projects", () => {
    expect(getAllowedProjectStatusTransitions("active")).toEqual([
      "paused",
      "ended",
    ]);
  });

  it("allows ended projects to enter settlement", () => {
    expect(() => assertProjectTransition("ended", "settling")).not.toThrow();
  });
});
