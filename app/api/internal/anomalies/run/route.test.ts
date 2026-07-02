import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { scanLiveOperationAnomalies } from "@/features/anomalies/anomaly-scanner";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/anomalies/anomaly-scanner", () => ({
  scanLiveOperationAnomalies: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const supabase = {
  from: vi.fn(),
};
const runnerOrganizationId = "11111111-1111-4111-8111-111111111111";
const runnerUserId = "22222222-2222-4222-8222-222222222222";

describe("/api/internal/anomalies/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ANOMALY_RUNNER_TOKEN", "runner-token");
    vi.stubEnv("ANOMALY_RUNNER_ORGANIZATION_ID", runnerOrganizationId);
    vi.stubEnv("ANOMALY_RUNNER_USER_ID", runnerUserId);
    vi.stubEnv("ANOMALY_RUNNER_USER_NAME", "System Anomaly Runner");
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(scanLiveOperationAnomalies).mockResolvedValue({
      detectedCount: 2,
      sentCount: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects missing runner token without scanning", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/anomalies/run", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
    expect(scanLiveOperationAnomalies).not.toHaveBeenCalled();
  });

  it("rejects invalid runner token without scanning", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/anomalies/run", {
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
    expect(scanLiveOperationAnomalies).not.toHaveBeenCalled();
  });

  it("rejects a token without the bearer scheme", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/anomalies/run", {
        method: "POST",
        headers: { authorization: "runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
    expect(scanLiveOperationAnomalies).not.toHaveBeenCalled();
  });

  it("fails safely when the admin client is unavailable", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);

    const response = await POST(
      new Request("http://localhost/api/internal/anomalies/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Supabase admin client is unavailable",
    });
    expect(scanLiveOperationAnomalies).not.toHaveBeenCalled();
  });

  it("requires a configured runner organization", async () => {
    vi.stubEnv("ANOMALY_RUNNER_ORGANIZATION_ID", "");

    const response = await POST(
      new Request("http://localhost/api/internal/anomalies/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Anomaly runner organization and user are not configured",
    });
    expect(scanLiveOperationAnomalies).not.toHaveBeenCalled();
  });

  it("requires a UUID-shaped runner user", async () => {
    vi.stubEnv("ANOMALY_RUNNER_USER_ID", "user-runner");

    const response = await POST(
      new Request("http://localhost/api/internal/anomalies/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Anomaly runner organization and user are not configured",
    });
    expect(scanLiveOperationAnomalies).not.toHaveBeenCalled();
  });

  it("runs the anomaly scan with the configured system actor", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/anomalies/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: { detectedCount: 2, sentCount: 1 },
    });
    expect(scanLiveOperationAnomalies).toHaveBeenCalledWith({
      client: supabase,
      actor: {
        userId: runnerUserId,
        name: "System Anomaly Runner",
        role: "ops_manager",
        organizationId: runnerOrganizationId,
      },
    });
  });

  it("sanitizes runner failures and never leaks paths or secrets", async () => {
    vi.mocked(scanLiveOperationAnomalies).mockRejectedValue(
      new Error("scan failed private/path.png with secret=abc123"),
    );

    const response = await POST(
      new Request("http://localhost/api/internal/anomalies/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      errorCode: "runner_failed",
      errorMessage: "scan failed [redacted] with secret=[redacted]",
    });
    expect(JSON.stringify(body)).not.toContain("private/path.png");
    expect(JSON.stringify(body)).not.toContain("secret=abc123");
  });
});
