import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { createSupabaseBillingRepo } from "@/features/billing/billing-repo-supabase";
import {
  listStaleUsageReservations,
  markStaleUsageReservationReviewed,
  resetStaleUsageReservationReview,
} from "@/features/billing/usage-reservations";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/billing/billing-repo-supabase", () => ({
  createSupabaseBillingRepo: vi.fn(),
}));

vi.mock("@/features/billing/providers/registry", () => ({
  getPaymentProvider: vi.fn(),
}));

vi.mock("@/features/billing/reconciliation", () => ({
  runReconciliation: vi.fn(),
}));

vi.mock("@/features/billing/subscription-jobs", () => ({
  runDunningSweep: vi.fn(),
  runExpirePendingOrdersSweep: vi.fn(),
  runRenewalSweep: vi.fn(),
}));

vi.mock("@/features/billing/usage-reservations", () => ({
  listStaleUsageReservations: vi.fn(),
  markStaleUsageReservationReviewed: vi.fn(),
  resetStaleUsageReservationReview: vi.fn(),
}));

vi.mock("@/features/funnel/funnel-events", () => ({
  recordFunnelEvent: vi.fn(),
}));

vi.mock("@/lib/audit/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/notify/notify", () => ({
  sendNotification: vi.fn(),
}));

const admin = { rpc: vi.fn(), from: vi.fn() };

describe("billing scheduled jobs route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00.000Z"));
    vi.stubEnv("BILLING_CRON_SECRET", "billing-secret");
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
    vi.mocked(createSupabaseBillingRepo).mockReturnValue({} as never);
    vi.mocked(listStaleUsageReservations).mockResolvedValue([
      {
        reservationId: "reservation-1",
        organizationId: "org-1",
        source: "ocr_job",
        reservedAt: "2026-07-29T08:00:00.000Z",
        lastReviewedAt: null,
        ageSeconds: 187_200,
      },
      {
        reservationId: "reservation-2",
        organizationId: "org-2",
        source: "ocr_job",
        reservedAt: "2026-07-30T08:00:00.000Z",
        lastReviewedAt: "2026-07-29T12:00:00.000Z",
        ageSeconds: 100_800,
      },
    ]);
    vi.mocked(markStaleUsageReservationReviewed).mockImplementation(
      async ({ reservationId }) =>
        reservationId === "reservation-1"
          ? {
              reservationId,
              organizationId: "org-1",
              source: "ocr_job",
              reservedAt: "2026-07-29T08:00:00.000Z",
              previousReviewedAt: null,
              reviewedAt: "2026-07-31T12:00:00.000Z",
              ageSeconds: 187_200,
            }
          : {
              reservationId,
              organizationId: "org-2",
              source: "ocr_job",
              reservedAt: "2026-07-30T08:00:00.000Z",
              previousReviewedAt: "2026-07-29T12:00:00.000Z",
              reviewedAt: "2026-07-31T12:00:00.000Z",
              ageSeconds: 100_800,
            },
    );
    vi.mocked(resetStaleUsageReservationReview).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("audits stale reservations without releasing them or returning review details", async () => {
    const response = await POST(
      new Request(
        "http://localhost/api/billing/jobs/stale-usage-reservations?limit=9999",
        {
          method: "POST",
          headers: { "x-cron-secret": "billing-secret" },
        },
      ),
      { params: Promise.resolve({ task: "stale-usage-reservations" }) },
    );

    expect(response.status).toBe(200);
    expect(listStaleUsageReservations).toHaveBeenCalledWith({
      client: admin,
      before: "2026-07-30T12:00:00.000Z",
      limit: 500,
    });
    expect(markStaleUsageReservationReviewed).toHaveBeenNthCalledWith(1, {
      client: admin,
      reservationId: "reservation-1",
      expectedReservedAt: "2026-07-29T08:00:00.000Z",
      expectedLastReviewedAt: null,
      before: "2026-07-30T12:00:00.000Z",
    });
    expect(writeAuditLog).toHaveBeenCalledTimes(2);
    expect(writeAuditLog).toHaveBeenNthCalledWith(
      1,
      admin,
      expect.objectContaining({
        organizationId: "org-1",
        action: "update",
        module: "billing",
        objectType: "usage_reservation",
        objectId: "reservation-1",
        reason: "stale_usage_reservation_reviewed",
        changedFields: ["last_reviewed_at"],
        after: {
          reservationId: "reservation-1",
          source: "ocr_job",
          reservedAt: "2026-07-29T08:00:00.000Z",
          ageSeconds: 187_200,
        },
      }),
    );
    const body = await response.json();
    expect(body).toEqual({
      task: "stale-usage-reservations",
      summary: {
        before: "2026-07-30T12:00:00.000Z",
        thresholdHours: 24,
        limit: 500,
        candidateCount: 2,
        reviewedCount: 2,
        skippedCount: 0,
        organizationCount: 2,
        oldestAgeSeconds: 187_200,
      },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /reservation-1|reservation-2|ocr_job|metadata/,
    );
  });

  it("skips a candidate whose reservation attempt changed before marking", async () => {
    vi.mocked(markStaleUsageReservationReviewed).mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/billing/jobs/stale-usage-reservations", {
        method: "POST",
        headers: { "x-cron-secret": "billing-secret" },
      }),
      { params: Promise.resolve({ task: "stale-usage-reservations" }) },
    );

    expect(response.status).toBe(200);
    expect(writeAuditLog).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      summary: { candidateCount: 2, reviewedCount: 0, skippedCount: 2 },
    });
  });

  it("restores review progression and hides audit errors so the row can retry", async () => {
    vi.mocked(listStaleUsageReservations).mockResolvedValueOnce([
      {
        reservationId: "reservation-1",
        organizationId: "org-1",
        source: "ocr_job",
        reservedAt: "2026-07-29T08:00:00.000Z",
        lastReviewedAt: null,
        ageSeconds: 187_200,
      },
    ]);
    vi.mocked(writeAuditLog).mockRejectedValueOnce(
      new Error("database secret metadata"),
    );

    const response = await POST(
      new Request("http://localhost/api/billing/jobs/stale-usage-reservations", {
        method: "POST",
        headers: { "x-cron-secret": "billing-secret" },
      }),
      { params: Promise.resolve({ task: "stale-usage-reservations" }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Stale usage reservation review failed",
    });
    expect(resetStaleUsageReservationReview).toHaveBeenCalledWith({
      client: admin,
      reservationId: "reservation-1",
      expectedReservedAt: "2026-07-29T08:00:00.000Z",
      failedReviewedAt: "2026-07-31T12:00:00.000Z",
      previousReviewedAt: null,
    });
  });

  it("rejects calls without the billing cron secret before using admin", async () => {
    const response = await POST(
      new Request("http://localhost/api/billing/jobs/stale-usage-reservations", {
        method: "POST",
      }),
      { params: Promise.resolve({ task: "stale-usage-reservations" }) },
    );

    expect(response.status).toBe(401);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(listStaleUsageReservations).not.toHaveBeenCalled();
  });
});
