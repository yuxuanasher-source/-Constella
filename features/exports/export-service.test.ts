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
  it("generates CSV using server-side field whitelist and writes export audit", async () => {
    const { client, auditInserts } = createClient();

    const result = await createGovernedExport({
      client,
      actor: {
        userId: "user-ops",
        name: "运营经理",
        role: "operator_business",
        organizationId: "org-1",
      },
      kind: "vendor_delivery",
      rows: [
        {
          projectName: "王者荣耀暑期冲榜",
          streamerName: "阿洛",
          settlementDuration: 120,
          evidenceLevel: "system",
          grossMarginCents: 3000,
        },
      ],
      now: "2026-06-02T10:00:00.000Z",
    });

    expect(result.filename).toBe("vendor_delivery-2026-06-02.csv");
    expect(result.content).toContain("项目名称,主播,结算时长,证据等级");
    expect(result.content).toContain("王者荣耀暑期冲榜,阿洛,120,system");
    expect(result.content).not.toContain("grossMarginCents");
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
});
