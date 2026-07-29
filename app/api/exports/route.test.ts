import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { createGovernedExport } from "@/features/exports/export-service";
import { buildSettlementBatchExportRows } from "@/features/exports/settlement-export-data";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/exports/export-service", () => ({
  createGovernedExport: vi.fn(),
}));

vi.mock("@/features/exports/settlement-export-data", () => ({
  buildReportSettlementExportRows: vi.fn(),
  buildSettlementBatchExportRows: vi.fn(),
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

describe("exports route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(createGovernedExport).mockResolvedValue({
      kind: "audit_logs",
      filename: "audit_logs-2026-06-02.csv",
      content: "模块,动作\nsettlement,lock",
      fieldCount: 2,
      rowCount: 1,
    });
    vi.mocked(buildSettlementBatchExportRows).mockResolvedValue([
      {
        batchName: "DB batch",
        ruleLabel: "固定规则 · 时长计费",
        evidenceLevel: "绿 1 / 黄 0 / 红 0 / 未知 0",
        varianceFlag: "无差异",
        systemAmountCents: 16000,
        manualAmountCents: 0,
        adjustmentAmountCents: 0,
        payableAmountCents: 16000,
        vendorReceivableCents: 0,
      },
    ]);
  });

  it("creates a governed export preview for MCN staff", async () => {
    const response = await POST(
      new Request("http://localhost/api/exports", {
        method: "POST",
        body: JSON.stringify({
          kind: "audit_logs",
          rows: [{ module: "settlement", action: "lock" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      export: {
        kind: "audit_logs",
        filename: "audit_logs-2026-06-02.csv",
        content: "模块,动作\nsettlement,lock",
        fieldCount: 2,
        rowCount: 1,
      },
    });
    expect(createGovernedExport).toHaveBeenCalledWith({
      client: { client: "supabase" },
      actor: auth,
      kind: "audit_logs",
      rows: [{ module: "settlement", action: "lock" }],
    });
  });

  it("ignores forged client rows for settlement batch exports", async () => {
    const response = await POST(
      new Request("http://localhost/api/exports", {
        method: "POST",
        body: JSON.stringify({
          kind: "settlement_batch",
          batchIds: ["batch-1"],
          rows: [
            {
              batchName: "forged",
              payableAmountCents: 999_999_999,
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(buildSettlementBatchExportRows).toHaveBeenCalledWith({
      client: { client: "supabase" },
      organizationId: "org-1",
      batchIds: ["batch-1"],
      periodStart: null,
      periodEnd: null,
    });
    expect(createGovernedExport).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "settlement_batch",
        rows: [
          expect.objectContaining({
            batchName: "DB batch",
            payableAmountCents: 16000,
          }),
        ],
        parameters: {
          batchIds: ["batch-1"],
          periodStart: null,
          periodEnd: null,
        },
      }),
    );
    expect(createGovernedExport).not.toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [expect.objectContaining({ batchName: "forged" })],
      }),
    );
  });

  it("blocks streamers from creating operations exports", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await POST(
      new Request("http://localhost/api/exports", {
        method: "POST",
        body: JSON.stringify({ kind: "audit_logs" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(createGovernedExport).not.toHaveBeenCalled();
  });
});
