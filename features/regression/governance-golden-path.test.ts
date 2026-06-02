import { describe, expect, it, vi } from "vitest";

import { detectTaskAnomalies } from "@/features/anomalies/anomaly-rules";
import { toVendorDeliveryPackageItem } from "@/features/delivery-packages/delivery-package-dto";
import { getAllowedExportFields } from "@/features/exports/export-definitions";
import { createGovernedExport } from "@/features/exports/export-service";
import { toNotificationCenterItem } from "@/features/notifications/notification-center-queries";

describe("P3 governance golden path", () => {
  it("keeps notifications, anomalies, exports, and delivery packages server-side governed", async () => {
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

    const vendorFields = getAllowedExportFields(
      "vendor_delivery",
      "operator_business",
    );

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
      kind: "vendor_delivery",
      rows: [
        {
          projectName: "王者荣耀暑期冲榜",
          streamerName: "阿洛",
          settlementDuration: 120,
          evidenceLevel: "system",
          grossMarginCents: 3000,
          costCents: 10000,
        },
      ],
      now: "2026-06-02T10:00:00.000Z",
    });

    const deliveryPackage = toVendorDeliveryPackageItem({
      project_id: "project-1",
      project_name: "王者荣耀暑期冲榜",
      streamer_name: "阿洛",
      settlement_duration_minutes: 120,
      evidence_level: "system",
      screenshot_count: 2,
      cost_cents: 10000,
      gross_margin_cents: 3000,
      vendor_receivable_cents: 13000,
      internal_risk_note: "历史争议",
    });

    expect(notification).toMatchObject({
      id: "notice-1",
      isHighRisk: true,
      status: "unread",
    });
    expect(anomalies.map((item) => item.type)).toContain("not_started");
    expect(vendorFields.map((field) => field.key)).not.toEqual(
      expect.arrayContaining([
        "grossMarginCents",
        "costCents",
        "vendorReceivableCents",
      ]),
    );
    expect(exportResult.content).not.toContain("grossMarginCents");
    expect(auditInserts).toEqual([
      expect.objectContaining({
        action: "export",
        module: "export",
      }),
    ]);
    expect(JSON.stringify(deliveryPackage)).not.toMatch(
      /cost|gross|margin|receivable|internal/i,
    );
  });
});
