import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { scanLiveOperationAnomalies } from "@/features/anomalies/anomaly-scanner";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/anomalies/anomaly-scanner", () => ({
  scanLiveOperationAnomalies: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-ops",
  email: "ops@jy-demo.local",
  name: "Ops Manager",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "ops_manager" as const,
};

describe("anomaly scan route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(scanLiveOperationAnomalies).mockResolvedValue({
      detectedCount: 2,
      sentCount: 1,
    });
  });

  it("allows MCN operators to manually trigger an anomaly scan", async () => {
    const response = await POST(
      new Request("http://localhost/api/anomalies/scan"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: { detectedCount: 2, sentCount: 1 },
    });
    expect(scanLiveOperationAnomalies).toHaveBeenCalledWith({
      client: { client: "supabase" },
      actor: auth,
    });
  });

  it("blocks finance from triggering operational anomaly scans", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "finance",
    });

    const response = await POST(
      new Request("http://localhost/api/anomalies/scan"),
    );

    expect(response.status).toBe(403);
    expect(scanLiveOperationAnomalies).not.toHaveBeenCalled();
  });
});
