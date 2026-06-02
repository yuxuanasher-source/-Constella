import { describe, expect, it } from "vitest";

import {
  toOpsReferenceReport,
  toOpsReferenceTask,
  toStreamerReferenceTask,
} from "./live-ui-adapters";

describe("live UI adapters", () => {
  it("maps streamer task DTOs into the existing mobile reference shape", () => {
    const task = toStreamerReferenceTask(
      {
        id: "task-1",
        title: "New Game Launch Week · Streamer One",
        status: "report_pending_review",
        projectName: "New Game Launch Week",
        plannedStartAt: "2026-06-02T11:00:00.000Z",
        plannedEndAt: "2026-06-02T13:00:00.000Z",
        plannedDuration: 120,
        systemDuration: 115,
      },
      { now: "2026-06-02T09:00:00.000Z" },
    );

    expect(task).toMatchObject({
      id: "task-1",
      date: "今天",
      dateStr: "06-02 周二",
      projectName: "New Game Launch Week",
      start: "19:00",
      end: "21:00",
      durationPlan: 2,
      status: "pending_review",
      needStartStop: true,
    });
    expect(JSON.stringify(task)).not.toContain("amount");
  });

  it("maps ops task DTOs into the existing schedule task shape", () => {
    const task = toOpsReferenceTask({
      id: "task-1",
      title: "Launch Week · Streamer One",
      status: "pending_report",
      projectId: "project-1",
      projectName: "Launch Week",
      streamerId: "streamer-1",
      streamerName: "Streamer One",
      plannedStartAt: "2026-06-02T11:00:00.000Z",
      plannedEndAt: "2026-06-02T13:30:00.000Z",
      plannedDuration: 150,
      systemDuration: 145,
    });

    expect(task).toMatchObject({
      id: "task-1",
      streamerId: "streamer-1",
      streamerName: "Streamer One",
      project: "project-1",
      projectName: "Launch Week",
      name: "Launch Week · Streamer One",
      type: "project",
      status: "pending_report",
      startHour: 19,
      endHour: 21.5,
    });
  });

  it("preserves cancelled task status for the ops schedule UI", () => {
    const task = toOpsReferenceTask({
      id: "task-cancelled",
      title: "Launch Week · Cancelled Streamer",
      status: "cancelled",
      projectId: "project-1",
      projectName: "Launch Week",
      streamerId: "streamer-1",
      streamerName: "Streamer One",
      plannedStartAt: "2026-06-02T11:00:00.000Z",
      plannedEndAt: "2026-06-02T13:30:00.000Z",
      plannedDuration: 150,
      systemDuration: 0,
    });

    expect(task.status).toBe("cancelled");
  });

  it("maps ops report queue DTOs without settlement amounts", () => {
    const report = toOpsReferenceReport({
      id: "report-1",
      status: "pending_review",
      taskTitle: "Launch Week · Streamer One",
      projectName: "Launch Week",
      streamerName: "Streamer One",
      settlementDuration: 115,
      timeSource: "system",
      evidenceLevel: "green",
      viewers: 952,
      submittedAt: "2026-06-02T13:05:00.000Z",
    });

    expect(report).toEqual({
      id: "report-1",
      date: "2026-06-02",
      streamer: "Streamer One",
      streamerId: "Streamer One",
      project: "Launch Week",
      taskId: "Launch Week · Streamer One",
      duration: 1.9,
      audience: 952,
      status: "pending_review",
      screens: 1,
      source: "OCR",
      note: "system · green",
    });
    expect(JSON.stringify(report)).not.toContain("amount");
  });
});
