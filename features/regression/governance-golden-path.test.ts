import { describe, expect, it, vi } from "vitest";

import { detectTaskAnomalies } from "@/features/anomalies/anomaly-rules";
import { isExportKind } from "@/features/exports/export-definitions";
import { createGovernedExport } from "@/features/exports/export-service";
import { toNotificationCenterItem } from "@/features/notifications/notification-center-queries";

describe("P3 governance golden path", () => {
  it("keeps notifications, anomalies, and general exports server-side governed", async () => {
    const notification = toNotificationCenterItem({
      id: "notice-1",
      notification_type: "high_risk",
      status: "unread",
      title: "结算批次重开",
      content: "批次被 owner 重开",
      object_type: "settlement_batch",
      object_id: "batch-1",
      is_high_risk: true,
      created_at: "2026-06-02T10:00:00.000Z",
    });

    const anomalies = detectTaskAnomalies({
      now: "2026-06-02T13:00:00.000Z",
      task: {
        id: "task-1",
        status: "pending_live",
        planned_start_at: "2026-06-02T12:00:00.000Z",
        planned_end_at: "2026-06-02T14:00:00.000Z",
        system_started_at: null,
        system_stopped_at: null,
        has_report: false,
        has_checkout_screenshot: false,
      },
    });

    const auditInserts: Record<string, unknown>[] = [];
    const exportResult = await createGovernedExport({
      client: {
        from: vi.fn(() => ({
          insert: vi.fn(async (payload: Record<string, unknown>) => {
            auditInserts.push(payload);
            return { error: null };
          }),
        })),
      },
      actor: {
        userId: "user-ops",
        name: "运营经理",
        role: "operator_business",
        organizationId: "org-1",
      },
      kind: "project_execution",
      rows: [
        {
          projectName: "王者荣耀暑期冲榜",
          status: "active",
          operatorName: "阿洛",
          grossMarginCents: 3000,
          costCents: 10000,
        },
      ],
      now: "2026-06-02T10:00:00.000Z",
    });

    expect(notification).toMatchObject({
      id: "notice-1",
      isHighRisk: true,
      status: "unread",
    });
    expect(anomalies.map((item) => item.type)).toContain("not_started");
    expect(isExportKind("vendor_delivery")).toBe(false);
    expect(exportResult.content).not.toContain("grossMarginCents");
    expect(auditInserts).toEqual([
      expect.objectContaining({
        action: "export",
        module: "export",
      }),
    ]);
  });
});
