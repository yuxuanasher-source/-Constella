import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { createSupabaseBillingRepo } from "@/features/billing/billing-repo-supabase";
import { listStaleUsageReservations } from "@/features/billing/usage-reservations";
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
        createdAt: "2026-07-29T08:00:00.000Z",
        ageSeconds: 187_200,
      },
      {
        reservationId: "reservation-2",
        organizationId: "org-2",
        source: "ocr_job",
        createdAt: "2026-07-30T08:00:00.000Z",
        ageSeconds: 100_800,
      },
    ]);
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
        reason: "stale_usage_reservation_detected",
        after: {
          reservationId: "reservation-1",
          source: "ocr_job",
          createdAt: "2026-07-29T08:00:00.000Z",
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
        staleCount: 2,
        organizationCount: 2,
        oldestAgeSeconds: 187_200,
      },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /reservation-1|reservation-2|ocr_job|metadata/,
    );
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
