import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { markIdlePlatformAccounts } from "@/features/account-library/account-lifecycle-service";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/account-library/account-lifecycle-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/account-library/account-lifecycle-service")
  >("@/features/account-library/account-lifecycle-service");
  return {
    ...actual,
    markIdlePlatformAccounts: vi.fn(),
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

function runRequest(init: RequestInit = {}) {
  return new Request(
    "http://localhost/api/internal/account-library/idle-scan/run",
    { method: "POST", body: JSON.stringify({}), ...init },
  );
}

describe("/api/internal/account-library/idle-scan/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ACCOUNT_LIBRARY_RUNNER_TOKEN", "runner-token");
    vi.stubEnv("ACCOUNT_LIBRARY_RUNNER_ORGANIZATION_ID", runnerOrganizationId);
    vi.stubEnv("ACCOUNT_LIBRARY_RUNNER_USER_ID", runnerUserId);
    vi.stubEnv("ACCOUNT_LIBRARY_RUNNER_USER_NAME", "System Account Runner");
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(markIdlePlatformAccounts).mockResolvedValue({
      scannedCount: 3,
      markedCount: 2,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a missing or wrong runner token without scanning", async () => {
    const missing = await POST(runRequest());
    expect(missing.status).toBe(401);

    const wrong = await POST(
      runRequest({ headers: { authorization: "Bearer wrong-token" } }),
    );
    expect(wrong.status).toBe(401);
    expect(markIdlePlatformAccounts).not.toHaveBeenCalled();
  });

  it("requires configured runner identity", async () => {
    vi.stubEnv("ACCOUNT_LIBRARY_RUNNER_ORGANIZATION_ID", "not-a-uuid");

    const response = await POST(
      runRequest({ headers: { authorization: "Bearer runner-token" } }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Account library runner organization and user are not configured",
    });
    expect(markIdlePlatformAccounts).not.toHaveBeenCalled();
  });

  it("marks idle accounts with the configured system actor", async () => {
    const response = await POST(
      runRequest({
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({ idleAfterDays: 30 }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: { scannedCount: 3, markedCount: 2 },
    });
    expect(markIdlePlatformAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        idleAfterDays: 30,
        actor: {
          userId: runnerUserId,
          name: "System Account Runner",
          role: "ops_manager",
          organizationId: runnerOrganizationId,
        },
      }),
    );
  });

  it("sanitizes runner failures", async () => {
    vi.mocked(markIdlePlatformAccounts).mockRejectedValue(
      new Error("scan failed private/path.png with secret=abc123"),
    );

    const response = await POST(
      runRequest({ headers: { authorization: "Bearer runner-token" } }),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.errorCode).toBe("runner_failed");
    expect(JSON.stringify(body)).not.toContain("private/path.png");
    expect(JSON.stringify(body)).not.toContain("secret=abc123");
  });
});
