import { describe, expect, it } from "vitest";

import {
  calculateExpiryBuckets,
  calculatePlatformMetrics,
} from "./platform-admin-metrics";

describe("calculatePlatformMetrics", () => {
  it("uses non-archived organizations as the ARP denominator", () => {
    expect(
      calculatePlatformMetrics({
        organizations: [
          { id: "a", lifecycleStatus: "active" },
          { id: "b", lifecycleStatus: "frozen" },
          { id: "c", lifecycleStatus: "archived" },
        ],
        transactions: [
          {
            organizationId: "a",
            orderId: "order-1",
            type: "payment",
            status: "succeeded",
            amountCents: 12000,
          },
          {
            organizationId: "a",
            orderId: "order-1",
            type: "refund",
            status: "succeeded",
            amountCents: 2000,
          },
        ],
        organizationCosts: [
          { organizationId: "a", costCents: 4000, complete: true },
        ],
        forecastRevenueCents: 18000,
      }),
    ).toMatchObject({
      organizationCount: 2,
      payingOrganizationCount: 1,
      successfulOrderCount: 1,
      netRevenueCents: 10000,
      forecastRevenueCents: 18000,
      arpCents: 5000,
      computableContributionMarginCents: 6000,
      costCoverage: { covered: 1, total: 2 },
    });
  });

  it("returns null ARP when there are no non-archived organizations", () => {
    const metrics = calculatePlatformMetrics({
      organizations: [{ id: "a", lifecycleStatus: "archived" }],
      transactions: [],
      organizationCosts: [],
    });

    expect(metrics.organizationCount).toBe(0);
    expect(metrics.arpCents).toBeNull();
  });

  it("does not treat missing or incomplete costs as zero", () => {
    const metrics = calculatePlatformMetrics({
      organizations: [
        { id: "a", lifecycleStatus: "active" },
        { id: "b", lifecycleStatus: "active" },
      ],
      transactions: [
        {
          organizationId: "a",
          orderId: "order-a",
          type: "payment",
          status: "succeeded",
          amountCents: 8000,
        },
        {
          organizationId: "b",
          orderId: "order-b",
          type: "payment",
          status: "succeeded",
          amountCents: 12000,
        },
      ],
      organizationCosts: [
        { organizationId: "a", costCents: 3000, complete: true },
        { organizationId: "b", costCents: 1000, complete: false },
      ],
    });

    expect(metrics.computableContributionMarginCents).toBe(5000);
    expect(metrics.costCoverage).toEqual({ covered: 1, total: 2 });
  });

  it("ignores pending and failed transactions", () => {
    const metrics = calculatePlatformMetrics({
      organizations: [{ id: "a", lifecycleStatus: "active" }],
      transactions: [
        {
          organizationId: "a",
          orderId: "paid",
          type: "payment",
          status: "succeeded",
          amountCents: 10000,
        },
        {
          organizationId: "a",
          orderId: "pending",
          type: "payment",
          status: "created",
          amountCents: 90000,
        },
        {
          organizationId: "a",
          orderId: "failed",
          type: "refund",
          status: "failed",
          amountCents: 80000,
        },
      ],
      organizationCosts: [],
    });

    expect(metrics.netRevenueCents).toBe(10000);
    expect(metrics.successfulOrderCount).toBe(1);
  });

  it("counts multiple successful orders but one paying organization", () => {
    const metrics = calculatePlatformMetrics({
      organizations: [{ id: "a", lifecycleStatus: "active" }],
      transactions: [
        {
          organizationId: "a",
          orderId: "order-1",
          type: "payment",
          status: "succeeded",
          amountCents: 5000,
        },
        {
          organizationId: "a",
          orderId: "order-2",
          type: "payment",
          status: "succeeded",
          amountCents: 7000,
        },
      ],
      organizationCosts: [],
    });

    expect(metrics.payingOrganizationCount).toBe(1);
    expect(metrics.successfulOrderCount).toBe(2);
  });
});

describe("calculateExpiryBuckets", () => {
  it("uses disjoint UTC-date buckets at the required boundaries", () => {
    const today = "2026-07-25";

    expect(
      calculateExpiryBuckets({
        today,
        periodEnds: [
          "2026-07-24",
          "2026-07-25",
          "2026-08-01",
          "2026-08-02",
          "2026-08-24",
        ],
      }),
    ).toEqual({
      expired: 1,
      within7Days: 2,
      within30Days: 2,
    });
  });
});
