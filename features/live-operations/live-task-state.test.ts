import { describe, expect, it } from "vitest";

import {
  assertLiveTaskTransition,
  deriveSystemDurationMinutes,
  type LiveTaskStatus,
} from "./live-task-state";

describe("live task state machine", () => {
  it("allows the planned fulfillment path", () => {
    const path: LiveTaskStatus[] = [
      "pending_live",
      "live",
      "pending_report",
      "report_pending_review",
      "report_approved",
      "completed",
    ];

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(() =>
        assertLiveTaskTransition(path[index], path[index + 1]),
      ).not.toThrow();
    }
  });

  it("rejects completing a task before report approval", () => {
    expect(() =>
      assertLiveTaskTransition("pending_report", "completed"),
    ).toThrow("Invalid live task status transition");
  });

  it("derives system duration in minutes from start and stop timestamps", () => {
    expect(
      deriveSystemDurationMinutes({
        startedAt: "2026-06-02T10:00:00.000Z",
        stoppedAt: "2026-06-02T11:42:20.000Z",
      }),
    ).toBe(102);
  });
});
