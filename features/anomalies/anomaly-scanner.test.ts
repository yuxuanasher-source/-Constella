import { describe, expect, it, vi } from "vitest";

import { scanLiveOperationAnomalies } from "./anomaly-scanner";

function createClient({ existingNotification = false } = {}) {
  const notificationInserts: Record<string, unknown>[] = [];
  const auditInserts: Record<string, unknown>[] = [];

  const taskQuery = {
    select: vi.fn(() => taskQuery),
    eq: vi.fn(() => taskQuery),
    order: vi.fn(() => taskQuery),
    limit: vi.fn(async () => ({
      data: [
        {
          id: "task-1",
          organization_id: "org-1",
          project_id: "project-1",
          status: "pending_live",
          title: "直播任务",
          planned_start_at: "2026-06-02T12:00:00.000Z",
          planned_end_at: "2026-06-02T14:00:00.000Z",
          system_started_at: null,
          system_stopped_at: null,
          has_report: false,
          has_checkout_screenshot: false,
        },
      ],
      error: null,
    })),
  };

  const notificationQuery = {
    select: vi.fn(() => notificationQuery),
    eq: vi.fn(() => notificationQuery),
    maybeSingle: vi.fn(async () => ({
      data: existingNotification ? { id: "notice-existing" } : null,
      error: null,
    })),
    insert: vi.fn(async (payload: Record<string, unknown>) => {
      notificationInserts.push(payload);
      return { error: null };
    }),
  };

  const auditQuery = {
    insert: vi.fn(async (payload: Record<string, unknown>) => {
      auditInserts.push(payload);
      return { error: null };
    }),
  };

  return {
    client: {
      from: vi.fn((table: string) => {
        if (table === "live_tasks") return taskQuery;
        if (table === "audit_logs") return auditQuery;
        if (table === "notifications") return notificationQuery;
        return taskQuery;
      }),
    },
    notificationInserts,
    auditInserts,
  };
}

describe("scanLiveOperationAnomalies", () => {
  it("sends notifications for newly detected anomalies and writes audit", async () => {
    const { client, notificationInserts, auditInserts } = createClient();

    const result = await scanLiveOperationAnomalies({
      client,
      actor: {
        userId: "user-ops",
        role: "ops_manager",
        name: "运营经理",
        organizationId: "org-1",
      },
      now: "2026-06-02T13:00:00.000Z",
    });

    expect(result.detectedCount).toBe(1);
    expect(result.sentCount).toBe(1);
    expect(notificationInserts).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        recipient_role: "ops_manager",
        notification_type: "anomaly",
        source: "anomaly:not_started:task-1",
      }),
    ]);
    expect(auditInserts).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        action: "create",
        module: "anomaly",
        object_type: "anomaly_scan",
        changed_fields: ["notifications"],
      }),
    ]);
  });

  it("does not send a duplicate notification for the same anomaly source", async () => {
    const { client, notificationInserts } = createClient({
      existingNotification: true,
    });

    const result = await scanLiveOperationAnomalies({
      client,
      actor: {
        userId: "user-ops",
        role: "ops_manager",
        name: "运营经理",
        organizationId: "org-1",
      },
      now: "2026-06-02T13:00:00.000Z",
    });

    expect(result.detectedCount).toBe(1);
    expect(result.sentCount).toBe(0);
    expect(notificationInserts).toEqual([]);
  });
});
