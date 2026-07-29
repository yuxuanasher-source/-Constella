import { describe, expect, it } from "vitest";

import {
  listOpsLiveReportQueue,
  listOpsLiveTaskQueue,
  toOpsLiveReportQueueItem,
  toOpsLiveTaskQueueItem,
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
      live_task_id: "task-1",
      project_id: "project-1",
      streamer_id: "streamer-1",
      status: "pending_review",
      settlement_duration: 120,
      system_duration: 120,
      screenshot_duration: 118,
      divergence_pct: 0.0167,
      time_source: "system",
      evidence_level: "green",
      viewers: 960,
      risk_flags: ["duration_divergence"],
      created_at: "2026-06-02T12:05:00.000Z",
      live_tasks: { title: "Project A · Streamer 1" },
      projects: { name: "Project A" },
      streamers: { display_name: "Streamer 1" },
      report_screenshots: [
        {
          file_hash: "sha256:old",
          uploaded_at: "2026-06-02T12:01:00.000Z",
        },
        {
          file_hash: "sha256:new",
          uploaded_at: "2026-06-02T12:06:00.000Z",
        },
      ],
    });

    expect(item).toEqual({
      id: "report-1",
      taskId: "task-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      status: "pending_review",
      taskTitle: "Project A · Streamer 1",
      projectName: "Project A",
      streamerName: "Streamer 1",
      settlementDuration: 120,
      systemDuration: 120,
      screenshotDuration: 118,
      divergencePct: 0.0167,
      timeSource: "system",
      evidenceLevel: "green",
      viewers: 960,
      riskFlags: ["duration_divergence"],
      submittedAt: "2026-06-02T12:05:00.000Z",
      screenshotUploadedAt: "2026-06-02T12:06:00.000Z",
      screenshotFileHash: "sha256:new",
    });
    expect(JSON.stringify(item)).not.toContain("amount");
  });

  it("maps ops live task queue items with task type", () => {
    const item = toOpsLiveTaskQueueItem({
      id: "task-training",
      title: "Project A · Streamer 1",
      status: "pending_live",
      task_type: "training",
      project_id: "project-1",
      streamer_id: "streamer-1",
      planned_start_at: "2026-06-02T10:00:00.000Z",
      planned_end_at: "2026-06-02T12:00:00.000Z",
      planned_duration: 120,
      system_duration: 0,
      projects: { name: "Project A" },
      streamers: { display_name: "Streamer 1" },
    });

    expect(item).toMatchObject({
      id: "task-training",
      taskType: "training",
    });
  });
});

describe("live operations queue queries", () => {
  it("scopes ops live task refreshes to the current organization", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const query = {
      select(...args: unknown[]) {
        calls.push(["select", args]);
        return this;
      },
      eq(...args: unknown[]) {
        calls.push(["eq", args]);
        return this;
      },
      order(...args: unknown[]) {
        calls.push(["order", args]);
        return this;
      },
      limit(...args: unknown[]) {
        calls.push(["limit", args]);
        return this;
      },
      returns() {
        calls.push(["returns", []]);
        return Promise.resolve({ data: [], error: null });
      },
    };
    const client = {
      from(...args: unknown[]) {
        calls.push(["from", args]);
        return query;
      },
    };

    await listOpsLiveTaskQueue(client as never, "org-1");

    expect(calls).toContainEqual(["from", ["live_tasks"]]);
    expect(calls).toContainEqual(["eq", ["organization_id", "org-1"]]);
    expect(calls).toContainEqual(["limit", [200]]);
  });

  it("caps the task queue at the newest rows but keeps ascending planned order", async () => {
    const taskRow = (id: string, plannedStartAt: string | null) => ({
      id,
      title: id,
      status: "pending_live",
      task_type: "project",
      project_id: "project-1",
      streamer_id: "streamer-1",
      planned_start_at: plannedStartAt,
      planned_end_at: null,
      planned_duration: 120,
      system_duration: 0,
      projects: { name: "Project A" },
      streamers: { display_name: "Streamer 1" },
    });
    const orderCalls: unknown[][] = [];
    // 数据库按 planned_start_at desc 返回（NULL 在前）。
    const rowsDesc = [
      taskRow("task-unscheduled", null),
      taskRow("task-new", "2026-06-17T08:00:00.000Z"),
      taskRow("task-old", "2026-06-16T08:00:00.000Z"),
    ];
    const query = {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      order(...args: unknown[]) {
        orderCalls.push(args);
        return this;
      },
      limit() {
        return this;
      },
      returns() {
        return Promise.resolve({ data: rowsDesc, error: null });
      },
    };
    const client = {
      from() {
        return query;
      },
    };

    const items = await listOpsLiveTaskQueue(client as never, "org-1");

    expect(orderCalls).toContainEqual([
      "planned_start_at",
      { ascending: false },
    ]);
    expect(items.map((item) => item.id)).toEqual([
      "task-old",
      "task-new",
      "task-unscheduled",
    ]);
  });

  it("scopes ops report queue refreshes to the current organization", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const query = {
      select(...args: unknown[]) {
        calls.push(["select", args]);
        return this;
      },
      in(...args: unknown[]) {
        calls.push(["in", args]);
        return this;
      },
      eq(...args: unknown[]) {
        calls.push(["eq", args]);
        return this;
      },
      order(...args: unknown[]) {
        calls.push(["order", args]);
        return this;
      },
      limit(...args: unknown[]) {
        calls.push(["limit", args]);
        return this;
      },
      returns() {
        calls.push(["returns", []]);
        return Promise.resolve({ data: [], error: null });
      },
    };
    const client = {
      from(...args: unknown[]) {
        calls.push(["from", args]);
        return query;
      },
    };

    await listOpsLiveReportQueue(client as never, "org-1");

    expect(calls).toContainEqual(["from", ["live_reports"]]);
    expect(calls).toContainEqual(["limit", [200]]);
    expect(calls).toContainEqual([
      "in",
      [
        "status",
        [
          "pending_review",
          "pending_adjudication",
          "approved",
          "rejected",
          "need_more",
        ],
      ],
    ]);
    expect(calls).toContainEqual(["eq", ["organization_id", "org-1"]]);
  });
});
