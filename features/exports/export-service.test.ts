import { describe, expect, it, vi } from "vitest";

import { createGovernedExport } from "./export-service";

function createClient() {
  const auditInserts: Record<string, unknown>[] = [];
  return {
    client: {
      from: vi.fn(() => ({
        insert: vi.fn(async (payload: Record<string, unknown>) => {
          auditInserts.push(payload);
          return { error: null };
        }),
      })),
    },
    auditInserts,
  };
}

describe("createGovernedExport", () => {
  it("generates admission recording exports with Chinese headers", async () => {
    const { client } = createClient();

    const result = await createGovernedExport({
      client,
      actor: {
        userId: "user-ops",
        name: "运营经理",
        role: "ops_manager",
        organizationId: "org-1",
      },
      kind: "admission_recordings",
      rows: [
        {
          projectCode: "P-001",
          projectName: "Alpha",
          vendorProduct: "Vendor / Game",
          streamerName: "主播一",
          streamerAccount: "Douyin / one-live",
          recordingUrl: "https://video.example/rec-1",
          recordingVersion: 1,
          recordingSubmittedAt: "2026-06-07T01:10:00.000Z",
          mcnReviewStatus: "recording_reviewing",
          vendorDecision: "pending",
          vendorRemark: "",
        },
      ],
      now: "2026-06-07T10:00:00.000Z",
    });

    expect(result.content.split("\n")[0]).toBe(
      "项目编号,项目名称,厂商/产品,主播,主播账号,录屏链接,录屏版本,录屏提交时间,MCN审核状态,厂商决策,厂商备注",
    );
  });

  it("generates governance CSV using a server-side field whitelist and writes export audit", async () => {
    const { client, auditInserts } = createClient();

    const result = await createGovernedExport({
      client,
      actor: {
        userId: "user-ops",
        name: "运营经理",
        role: "operator_business",
        organizationId: "org-1",
      },
      kind: "project_execution",
      rows: [
        {
          projectName: "王者荣耀暑期冲榜",
          status: "active",
          operatorName: "阿洛",
          grossMarginCents: 3000,
          supplierCostCents: 271828,
          internalRiskNote: "内部风险-只读",
          vendorReceivableCents: 424242,
        },
      ],
      now: "2026-06-02T10:00:00.000Z",
    });

    expect(result.filename).toBe("project_execution-2026-06-02.csv");
    expect(result.content).toContain("项目名称,状态,负责人");
    expect(result.content).toContain("王者荣耀暑期冲榜,active,阿洛");
    expect(result.content).not.toContain("grossMarginCents");
    expect(result.content).not.toContain("271828");
    expect(result.content).not.toContain("内部风险-只读");
    expect(result.content).not.toContain("424242");
    expect(auditInserts).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        action: "export",
        module: "export",
        object_type: "export_job",
        changed_fields: ["export_kind", "row_count"],
      }),
    ]);
  });

  it("neutralizes spreadsheet formula injection in cell values", async () => {
    const { client } = createClient();

    const result = await createGovernedExport({
      client,
      actor: {
        userId: "user-ops",
        name: "运营经理",
        role: "operator_business",
        organizationId: "org-1",
      },
      kind: "project_execution",
      rows: [
        {
          projectName: '=HYPERLINK("http://evil.example","x")',
          status: "+1234",
          operatorName: "Ops",
        },
      ],
      now: "2026-06-02T10:00:00.000Z",
    });

    // Formula-triggering values are prefixed with a single quote (and quoted
    // because they now contain a comma / quote) so spreadsheets treat them as
    // text rather than evaluating them.
    expect(result.content).toContain(
      `"'=HYPERLINK(""http://evil.example"",""x"")"`,
    );
    expect(result.content).toContain("'+1234");
    expect(result.content).not.toMatch(/(^|,)=HYPERLINK/);
  });
});
