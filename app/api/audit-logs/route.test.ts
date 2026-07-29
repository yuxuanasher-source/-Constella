import { describe, expect, it, vi, beforeEach } from "vitest";

import * as auditLogsRoute from "./route";
import { GET } from "./route";

import { listAuditCenterEntries } from "@/features/audit-center/audit-center-queries";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/audit-center/audit-center-queries", () => ({
  listAuditCenterEntries: vi.fn(),
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

describe("audit logs route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("maps audit center query params into the read-only query service", async () => {
    vi.mocked(listAuditCenterEntries).mockResolvedValueOnce([
      {
        id: "audit-1",
        actorName: "Ops Manager",
        actorRole: "ops_manager",
        action: "lock",
        module: "settlement",
        objectType: "settlement_batch",
        objectId: "batch-1",
        objectName: null,
        projectId: "project-1",
        streamerId: null,
        changedFields: ["status"],
        reason: "财务核对无误",
        isHighRisk: true,
        result: "success",
        errorMessage: null,
        createdAt: "2026-06-02T10:00:00.000Z",
      },
    ]);

    const response = await GET(
      new Request(
        "http://localhost/api/audit-logs?module=settlement&action=lock&projectId=project-1&objectType=settlement_batch&objectId=batch-1&highRiskOnly=1&limit=20",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      entries: [
        expect.objectContaining({
          id: "audit-1",
          module: "settlement",
          isHighRisk: true,
        }),
      ],
    });
    expect(listAuditCenterEntries).toHaveBeenCalledWith(
      { client: "supabase" },
      {
        userId: "user-ops",
        role: "ops_manager",
        organizationId: "org-1",
      },
      {
        module: "settlement",
        action: "lock",
        projectId: "project-1",
        objectType: "settlement_batch",
        objectId: "batch-1",
        highRiskOnly: true,
        limit: 20,
      },
    );
  });

  it("does not expose audit mutation handlers", () => {
    expect("POST" in auditLogsRoute).toBe(false);
    expect("PATCH" in auditLogsRoute).toBe(false);
    expect("DELETE" in auditLogsRoute).toBe(false);
  });
});
