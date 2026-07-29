import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { buildReportSettlementXlsx } from "@/features/exports/report-settlement-xlsx";
import { buildReportSettlementExportRows } from "@/features/exports/settlement-export-data";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

vi.mock("@/features/exports/report-settlement-xlsx", () => ({
  buildReportSettlementXlsx: vi.fn(),
  screenshotExtensionFromPath: vi.fn(() => "png"),
}));

vi.mock("@/features/exports/settlement-export-data", () => ({
  buildReportSettlementExportRows: vi.fn(),
}));

vi.mock("@/lib/audit/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({
  getServerEnv: vi.fn(() => ({ STORAGE_BUCKET_PRIVATE: "private" })),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-owner",
  email: "owner@jy-demo.local",
  name: "Owner",
  organizationId: "org-1",
  organizationName: "星辰公会",
  role: "owner" as const,
};

function createSupabase() {
  const query = {
    select: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(async () => ({ data: [], error: null })),
  };
  return {
    from: vi.fn(() => query),
  };
}

describe("report settlement xlsx export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const supabase = createSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(buildReportSettlementExportRows).mockResolvedValue([
      {
        reportId: "report-1",
        guildOrIndividual: "星辰公会",
        gameProduct: "Game A",
        streamerName: "DB Streamer",
        liveDate: "2026-06-02",
        liveTime: "20:00-22:00",
        duration: "2 小时",
        hourlyRate: "¥80",
        talentFee: "¥160",
        screenshot: "0 张",
      },
    ]);
    vi.mocked(buildReportSettlementXlsx).mockResolvedValue(
      Buffer.from("xlsx"),
    );
  });

  it("ignores forged rows and renders xlsx from server-built report rows", async () => {
    const response = await POST(
      new Request("http://localhost/api/exports/report-settlement-xlsx", {
        method: "POST",
        body: JSON.stringify({
          reportIds: ["report-1"],
          rows: [
            {
              reportId: "report-1",
              streamerName: "forged",
              talentFee: "¥999999",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      export: {
        filename: expect.stringMatching(/^report_settlement_details-/u),
        base64: Buffer.from("xlsx").toString("base64"),
      },
    });
    expect(buildReportSettlementExportRows).toHaveBeenCalledWith({
      client: expect.anything(),
      organizationId: "org-1",
      organizationName: "星辰公会",
      reportIds: ["report-1"],
      projectId: null,
      periodStart: null,
      periodEnd: null,
    });
    expect(buildReportSettlementXlsx).toHaveBeenCalledWith({
      role: "owner",
      rows: [
        expect.objectContaining({
          streamerName: "DB Streamer",
          talentFee: "¥160",
        }),
      ],
      screenshotByReportId: expect.any(Map),
    });
    expect(buildReportSettlementXlsx).not.toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [expect.objectContaining({ streamerName: "forged" })],
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({
          kind: "report_settlement_details_xlsx",
          rowCount: 1,
          parameters: expect.objectContaining({
            reportIds: ["report-1"],
          }),
        }),
      }),
    );
  });
});
