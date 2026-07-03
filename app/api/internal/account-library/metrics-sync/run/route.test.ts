import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { syncPlatformAccountMetrics } from "@/features/account-library/account-metrics-service";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/account-library/account-metrics-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/account-library/account-metrics-service")
  >("@/features/account-library/account-metrics-service");
  return {
    ...actual,
    syncPlatformAccountMetrics: vi.fn(),
  };
});

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const supabase = {
  from: vi.fn(),
};
const runnerOrganizationId = "11111111-1111-4111-8111-111111111111";
const runnerUserId = "22222222-2222-4222-8222-222222222222";

function runRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(
    "http://localhost/api/internal/account-library/metrics-sync/run",
    { method: "POST", body: JSON.stringify(body), headers },
  );
}

describe("/api/internal/account-library/metrics-sync/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ACCOUNT_LIBRARY_RUNNER_TOKEN", "runner-token");
    vi.stubEnv("ACCOUNT_LIBRARY_RUNNER_ORGANIZATION_ID", runnerOrganizationId);
    vi.stubEnv("ACCOUNT_LIBRARY_RUNNER_USER_ID", runnerUserId);
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(syncPlatformAccountMetrics).mockResolvedValue({
      scannedCount: 2,
      syncedCount: 2,
      skippedCount: 0,
      failures: [],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects an invalid runner token without syncing", async () => {
    const response = await POST(
      runRequest({}, { authorization: "Bearer wrong-token" }),
    );

    expect(response.status).toBe(401);
    expect(syncPlatformAccountMetrics).not.toHaveBeenCalled();
  });

  it("requires a metrics source when no endpoint is configured", async () => {
    const response = await POST(
      runRequest({}, { authorization: "Bearer runner-token" }),
    );

    expect(response.status).toBe(400);
    expect(syncPlatformAccountMetrics).not.toHaveBeenCalled();
  });

  it("syncs pushed metrics with the configured system actor", async () => {
    const response = await POST(
      runRequest(
        {
          metrics: [
            {
              accountId: "ACC-1",
              metricDate: "2026-07-02",
              followerCount: 100,
              liveViewCount: 50,
              gmvAmount: 12.5,
            },
          ],
        },
        { authorization: "Bearer runner-token" },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: { scannedCount: 2, syncedCount: 2, skippedCount: 0, failures: [] },
    });
    expect(syncPlatformAccountMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({
          userId: runnerUserId,
          role: "ops_manager",
          organizationId: runnerOrganizationId,
        }),
        fetcher: expect.any(Function),
      }),
    );
  });

  it("rejects malformed pushed metrics entries", async () => {
    const response = await POST(
      runRequest(
        { metrics: [{ metricDate: "2026-07-02" }] },
        { authorization: "Bearer runner-token" },
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "metrics entries require accountId and metricDate",
    });
    expect(syncPlatformAccountMetrics).not.toHaveBeenCalled();
  });

  it("uses the HTTP fetcher when an endpoint is configured", async () => {
    vi.stubEnv("PLATFORM_METRICS_ENDPOINT", "https://metrics.example.com/pull");

    const response = await POST(
      runRequest({}, { authorization: "Bearer runner-token" }),
    );

    expect(response.status).toBe(200);
    expect(syncPlatformAccountMetrics).toHaveBeenCalled();
  });

  it("sanitizes runner failures", async () => {
    vi.mocked(syncPlatformAccountMetrics).mockRejectedValue(
      new Error("sync failed private/path.png with secret=abc123"),
    );

    const response = await POST(
      runRequest(
        { metrics: [] },
        { authorization: "Bearer runner-token" },
      ),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.errorCode).toBe("runner_failed");
    expect(JSON.stringify(body)).not.toContain("private/path.png");
    expect(JSON.stringify(body)).not.toContain("secret=abc123");
  });
});
