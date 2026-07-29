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

  it("marks pending streamer tasks as missed when the planned window already ended", () => {
    const task = toStreamerReferenceTask(
      {
        id: "task-missed-live",
        title: "Project A · Streamer One",
        status: "pending_live",
        projectName: "Project A",
        plannedStartAt: "2026-06-04T12:00:00.000Z",
        plannedEndAt: "2026-06-04T15:30:00.000Z",
        plannedDuration: 210,
        systemDuration: 0,
      },
      { now: "2026-06-07T13:12:00.000Z" },
    );

    expect(task.status).toBe("missed_live");
    expect(task.note).toContain("未直播");
  });

  it("maps ops task DTOs into the existing schedule task shape", () => {
    const task = toOpsReferenceTask({
      id: "task-1",
      title: "Launch Week · Streamer One",
      status: "pending_report",
      taskType: "trial",
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
      type: "trial",
      status: "pending_report",
      startHour: 19,
      endHour: 21.5,
    });
  });

  it("preserves ops task planned windows for derived display status", () => {
    const task = toOpsReferenceTask({
      id: "task-window-ended",
      title: "Launch Week · Streamer One",
      status: "pending_live",
      taskType: "project",
      projectId: "project-1",
      projectName: "Launch Week",
      streamerId: "streamer-1",
      streamerName: "Streamer One",
      plannedStartAt: "2026-06-04T12:00:00.000Z",
      plannedEndAt: "2026-06-04T15:30:00.000Z",
      plannedDuration: 210,
      systemDuration: 0,
    });

    expect(task).toMatchObject({
      plannedStartAt: "2026-06-04T12:00:00.000Z",
      plannedEndAt: "2026-06-04T15:30:00.000Z",
      plannedDuration: 210,
    });
  });

  it("preserves cancelled task status for the ops schedule UI", () => {
    const task = toOpsReferenceTask({
      id: "task-cancelled",
      title: "Launch Week · Cancelled Streamer",
      status: "cancelled",
      taskType: "project",
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
      taskId: "task-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      status: "pending_review",
      taskTitle: "Launch Week · Streamer One",
      projectName: "Launch Week",
      streamerName: "Streamer One",
      settlementDuration: 115,
      systemDuration: 120,
      screenshotDuration: 90,
      divergencePct: 0.25,
      timeSource: "system",
      evidenceLevel: "green",
      viewers: 952,
      riskFlags: ["duration_divergence"],
      screenshotUploadedAt: "2026-06-02T13:06:00.000Z",
      screenshotFileHash: "sha256:abc",
      submittedAt: "2026-06-02T13:05:00.000Z",
    });

    expect(report).toEqual({
      id: "report-1",
      date: "2026-06-02",
      streamer: "Streamer One",
      streamerId: "streamer-1",
      project: "Launch Week",
      taskId: "task-1",
      duration: 1.9,
      systemDurationHours: 2,
      ocrDurationHours: 1.5,
      divergencePct: 0.25,
      audience: 952,
      status: "pending_review",
      screens: 1,
      source: "OCR",
      riskFlags: ["duration_divergence"],
      screenshotUploadedAt: "2026-06-02T13:06:00.000Z",
      screenshotFileHash: "sha256:abc",
      note: "system · green",
    });
    expect(JSON.stringify(report)).not.toContain("amount");
  });

  it("keeps adjudication reports visible in the pending review tab", () => {
    const report = toOpsReferenceReport({
      id: "report-adjudication",
      taskId: "task-adjudication",
      projectId: "project-1",
      streamerId: "streamer-1",
      status: "pending_adjudication",
      taskTitle: "Launch Week · Streamer One",
      projectName: "Launch Week",
      streamerName: "Streamer One",
      settlementDuration: 115,
      systemDuration: 120,
      screenshotDuration: null,
      divergencePct: null,
      timeSource: "system",
      evidenceLevel: "green",
      viewers: 952,
      riskFlags: [],
      submittedAt: "2026-06-02T13:05:00.000Z",
      screenshotUploadedAt: null,
      screenshotFileHash: null,
    });

    expect(report.status).toBe("pending_review");
  });
});
