import { describe, expect, it, vi } from "vitest";

import {
  calculateUsageStatus,
  getUsagePeriodMonth,
  recordUsageEvent,
} from "./usage-metering";

describe("calculateUsageStatus", () => {
  it("applies included quota and add-on credits before soft overage", () => {
    expect(
      calculateUsageStatus({
        metric: "ai",
        usedQuantity: 1300,
        includedQuantity: 1000,
        addonQuantity: 200,
      }),
    ).toEqual({
      metric: "ai",
      usedQuantity: 1300,
      includedQuantity: 1000,
      addonQuantity: 200,
      allowanceQuantity: 1200,
      remainingQuantity: 0,
      overageQuantity: 100,
      billableOverageQuantity: 100,
      softOverage: true,
      shouldHardBlock: false,
    });
  });

  it("hard-blocks OCR overage but keeps other metrics soft", () => {
    expect(
      calculateUsageStatus({
        metric: "ocr",
        usedQuantity: 260,
        includedQuantity: 200,
        addonQuantity: 0,
      }),
    ).toMatchObject({
      overageQuantity: 60,
      softOverage: false,
      shouldHardBlock: true,
    });

    expect(
      calculateUsageStatus({
        metric: "ai",
        usedQuantity: 1300,
        includedQuantity: 1000,
        addonQuantity: 200,
      }),
    ).toMatchObject({ shouldHardBlock: false, softOverage: true });
  });

  it("uses explicit nonnegative fallbacks for bad usage values", () => {
    expect(
      calculateUsageStatus({
        metric: "export",
        usedQuantity: -1,
        includedQuantity: 0,
        addonQuantity: 0,
      }),
    ).toMatchObject({
      usedQuantity: 0,
      remainingQuantity: 0,
      overageQuantity: 0,
      billableOverageQuantity: 0,
    });
  });
});

describe("getUsagePeriodMonth", () => {
  it("normalizes usage periods to the first day of the month", () => {
    expect(getUsagePeriodMonth("2026-06-23T18:30:00.000Z")).toBe(
      "2026-06-01",
    );
  });
});

describe("recordUsageEvent", () => {
  it("inserts a usage event and writes audit", async () => {
    const inserts: Record<string, unknown[]> = {};
    const client = {
      from: vi.fn((table: string) => ({
        insert: vi.fn(async (payload: unknown) => {
          inserts[table] = [...(inserts[table] ?? []), payload as unknown[]];
          return { error: null };
        }),
      })),
    };

    await recordUsageEvent({
      client,
      actor: {
        userId: "user-ops",
        name: "Ops Manager",
        role: "ops_manager",
        organizationId: "org-1",
      },
      input: {
        metric: "export",
        quantity: 2,
        source: "export_center",
        objectType: "export_job",
        objectId: "job-1",
        occurredAt: "2026-06-23T18:30:00.000Z",
      },
    });

    expect(inserts.usage_events).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        metric: "export",
        quantity: 2,
        period_month: "2026-06-01",
        source: "export_center",
      }),
    ]);
    expect(inserts.audit_logs).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        action: "create",
        module: "billing",
        object_type: "usage_event",
        changed_fields: ["metric", "quantity"],
      }),
    ]);
  });
});
