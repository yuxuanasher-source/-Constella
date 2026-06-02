import { describe, expect, it } from "vitest";

import { detectTaskAnomalies } from "./anomaly-rules";

const baseTask = {
  id: "task-1",
  status: "pending_live",
  planned_start_at: "2026-06-02T12:00:00.000Z",
  planned_end_at: "2026-06-02T14:00:00.000Z",
  system_started_at: null,
  system_stopped_at: null,
  has_report: false,
  has_checkout_screenshot: false,
};

describe("detectTaskAnomalies", () => {
  it("detects scheduled tasks that have not started after planned start", () => {
    const anomalies = detectTaskAnomalies({
      now: "2026-06-02T13:00:00.000Z",
      task: baseTask,
    });

    expect(anomalies).toContainEqual({
      type: "not_started",
      objectType: "live_task",
      objectId: "task-1",
      severity: "warning",
    });
  });

  it("detects completed tasks that have no report after planned end", () => {
    const anomalies = detectTaskAnomalies({
      now: "2026-06-02T16:30:00.000Z",
      task: {
        ...baseTask,
        status: "completed",
        system_started_at: "2026-06-02T12:00:00.000Z",
        system_stopped_at: "2026-06-02T14:00:00.000Z",
      },
    });

    expect(anomalies).toContainEqual({
      type: "not_reported",
      objectType: "live_task",
      objectId: "task-1",
      severity: "warning",
    });
    expect(anomalies).toContainEqual({
      type: "missing_checkout_screenshot",
      objectType: "live_task",
      objectId: "task-1",
      severity: "warning",
    });
  });

  it("detects live sessions running over 48 hours", () => {
    const anomalies = detectTaskAnomalies({
      now: "2026-06-04T13:30:00.000Z",
      task: {
        ...baseTask,
        status: "live",
        system_started_at: "2026-06-02T12:00:00.000Z",
      },
    });

    expect(anomalies).toContainEqual({
      type: "live_over_48h",
      objectType: "live_task",
      objectId: "task-1",
      severity: "danger",
    });
  });
});
