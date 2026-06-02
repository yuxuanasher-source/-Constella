import { describe, expect, it } from "vitest";

import {
  toOpsLiveReportQueueItem,
  toStreamerTaskCard,
} from "./live-operations-queries";

describe("live operations DTO mappers", () => {
  it("maps streamer task cards without internal financial fields", () => {
    const card = toStreamerTaskCard({
      id: "task-1",
      title: "Project A · Streamer 1",
      status: "pending_report",
      planned_start_at: "2026-06-02T10:00:00.000Z",
      planned_end_at: "2026-06-02T12:00:00.000Z",
      planned_duration: 120,
      system_duration: 118,
      projects: { name: "Project A" },
    });

    expect(card).toEqual({
      id: "task-1",
      title: "Project A · Streamer 1",
      status: "pending_report",
      projectName: "Project A",
      plannedStartAt: "2026-06-02T10:00:00.000Z",
      plannedEndAt: "2026-06-02T12:00:00.000Z",
      plannedDuration: 120,
      systemDuration: 118,
    });
    expect(JSON.stringify(card)).not.toContain("rate");
  });

  it("maps ops report queue items with evidence but no settlement amount", () => {
    const item = toOpsLiveReportQueueItem({
      id: "report-1",
      status: "pending_review",
      settlement_duration: 120,
      time_source: "system",
      evidence_level: "green",
      viewers: 960,
      created_at: "2026-06-02T12:05:00.000Z",
      live_tasks: { title: "Project A · Streamer 1" },
      projects: { name: "Project A" },
      streamers: { display_name: "Streamer 1" },
    });

    expect(item).toEqual({
      id: "report-1",
      status: "pending_review",
      taskTitle: "Project A · Streamer 1",
      projectName: "Project A",
      streamerName: "Streamer 1",
      settlementDuration: 120,
      timeSource: "system",
      evidenceLevel: "green",
      viewers: 960,
      submittedAt: "2026-06-02T12:05:00.000Z",
    });
    expect(JSON.stringify(item)).not.toContain("amount");
  });
});
