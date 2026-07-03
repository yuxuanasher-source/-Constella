import { beforeEach, describe, expect, it, vi } from "vitest";

import { getProjectComplexCostDashboard } from "@/features/complex-cost/complex-cost-queries";
import { listOpsSettlementPool } from "@/features/settlements/settlement-queries";
import { loadProjectReviewInput } from "./project-review-loader";

vi.mock("@/features/complex-cost/complex-cost-queries", () => ({
  getProjectComplexCostDashboard: vi.fn(),
}));

vi.mock("@/features/settlements/settlement-queries", () => ({
  listOpsSettlementPool: vi.fn(),
}));

type EqCall = [string, unknown];

function createClient(
  tables: Record<string, unknown[]>,
  eqCalls: Record<string, EqCall[]> = {},
) {
  return {
    from: vi.fn((table: string) => {
      const rows = tables[table] ?? [];
      const chain: Record<string, unknown> = {};
      const track =
        (name: string) =>
        (...args: unknown[]) => {
          if (name === "eq") {
            (eqCalls[table] ??= []).push([args[0] as string, args[1]]);
          }
          return chain;
        };
      chain.select = track("select");
      chain.eq = track("eq");
      chain.neq = track("neq");
      chain.gte = track("gte");
      chain.lte = track("lte");
      chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve);
      return chain;
    }),
  } as never;
}

const project = {
  id: "p1",
  name: "Campaign Alpha",
  starts_at: "2026-06-01T00:00:00.000Z",
  ends_at: "2026-06-30T00:00:00.000Z",
};

describe("loadProjectReviewInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProjectComplexCostDashboard).mockResolvedValue({
      supplierCostCents: 3000,
    } as never);
    vi.mocked(listOpsSettlementPool).mockResolvedValue([]);
  });

  it("returns null when the project is not visible in the organization", async () => {
    const client = createClient({ projects: [] });

    const result = await loadProjectReviewInput(client, {
      organizationId: "org-1",
      projectId: "p1",
    });

    expect(result).toBeNull();
  });

  it("assembles finance in cents, evidence summary and streamer aggregates from real rows", async () => {
    const eqCalls: Record<string, EqCall[]> = {};
    const client = createClient(
      {
        projects: [project],
        settlement_batches: [
          {
            batch_type: "receivable",
            status: "confirmed",
            period_start: "2026-06-01",
            period_end: "2026-06-30",
            computed_amount: 100.5,
            manual_amount: 20.25,
            adjustment_amount: 5.1,
          },
          {
            batch_type: "payable",
            status: "confirmed",
            period_start: "2026-06-01",
            period_end: "2026-06-30",
            computed_amount: 50,
            manual_amount: 0,
            adjustment_amount: 1.1,
          },
          {
            // 期间不重叠,必须被排除。
            batch_type: "receivable",
            status: "confirmed",
            period_start: "2026-01-01",
            period_end: "2026-01-31",
            computed_amount: 999,
            manual_amount: 0,
            adjustment_amount: 0,
          },
        ],
        live_reports: [
          {
            streamer_id: "s1",
            status: "approved",
            settlement_duration: 120,
            viewers: 4000,
            evidence_level: "green",
            risk_flags: [],
            streamers: { display_name: "Ava" },
          },
          {
            streamer_id: "s1",
            status: "approved",
            settlement_duration: 60,
            viewers: 1000,
            evidence_level: "yellow",
            risk_flags: ["duration_divergence"],
            streamers: { display_name: "Ava" },
          },
          {
            streamer_id: "s2",
            status: "pending",
            settlement_duration: 90,
            viewers: 500,
            evidence_level: null,
            risk_flags: null,
            streamers: { display_name: "Ben" },
          },
        ],
        live_tasks: [
          {
            streamer_id: "s1",
            status: "completed",
            anomaly_flags: [],
            streamers: { display_name: "Ava" },
          },
          {
            streamer_id: "s1",
            status: "abnormal",
            anomaly_flags: ["duration_divergence"],
            streamers: { display_name: "Ava" },
          },
          {
            streamer_id: "s2",
            status: "cancelled",
            anomaly_flags: [],
            streamers: { display_name: "Ben" },
          },
        ],
      },
      eqCalls,
    );

    const result = await loadProjectReviewInput(client, {
      organizationId: "org-1",
      projectId: "p1",
      targetMarginBps: 2500,
    });

    expect(result).not.toBeNull();
    const { input, dataGaps } = result!;

    // 元 → 分换算必须四舍五入;期间外批次不计入。
    expect(input.finance).toEqual({
      receivableCents: 12075,
      payableCents: 5000,
      supplierCostCents: 3000,
      adjustmentCents: 400,
      manualRevenueCents: 2025,
    });
    expect(input.project).toMatchObject({
      id: "p1",
      name: "Campaign Alpha",
      category: "unknown",
      platform: "unknown",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });
    expect(input.evidenceSummary).toEqual({
      green: 1,
      yellow: 1,
      red: 0,
      unknown: 1,
    });
    expect(input.targetMarginBps).toBe(2500);
    expect(input.suppliers).toEqual([]);

    const ava = input.streamers.find((streamer) => streamer.id === "s1");
    // grossMargin = 12075 - 5000 - 3000 + 400 = 4475,全部时长在 s1 名下。
    expect(ava).toMatchObject({
      name: "Ava",
      durationMinutes: 180,
      totalViews: 5000,
      completionRateBps: 5000,
      anomalyCount: 2,
      roiBps: 0,
      disputeCount: 0,
      grossMarginContributionCents: 4475,
    });
    const ben = input.streamers.find((streamer) => streamer.id === "s2");
    // pending 报数不计时长;cancelled 任务不计完成率。
    expect(ben).toMatchObject({ durationMinutes: 0, completionRateBps: 0 });

    expect(dataGaps).toEqual(
      expect.arrayContaining([
        "project_category",
        "project_platform",
        "supplier_quality",
        "streamer_roi",
        "streamer_disputes",
        "streamer_margin_allocation",
      ]),
    );
    expect(dataGaps).not.toContain("payable_from_pool_estimate");

    // 组织隔离:每张表都必须显式过滤 organization_id。
    for (const table of [
      "projects",
      "settlement_batches",
      "live_reports",
      "live_tasks",
    ]) {
      expect(eqCalls[table]).toEqual(
        expect.arrayContaining([["organization_id", "org-1"]]),
      );
    }
    expect(listOpsSettlementPool).not.toHaveBeenCalled();
  });

  it("falls back to the settlement pool estimate when no payable batch exists", async () => {
    vi.mocked(listOpsSettlementPool).mockResolvedValue([
      { expectedAmount: 80.5 },
      { expectedAmount: 19.5 },
    ] as never);
    const client = createClient({
      projects: [project],
      settlement_batches: [],
      live_reports: [],
      live_tasks: [],
    });

    const result = await loadProjectReviewInput(client, {
      organizationId: "org-1",
      projectId: "p1",
    });

    expect(result!.input.finance.payableCents).toBe(10000);
    expect(result!.dataGaps).toContain("payable_from_pool_estimate");
    expect(listOpsSettlementPool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "p1",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      }),
    );
  });

  it("declares a gap and counts zero when the supplier cost dashboard fails", async () => {
    vi.mocked(getProjectComplexCostDashboard).mockRejectedValue(
      new Error("complex cost unavailable"),
    );
    const client = createClient({
      projects: [project],
      settlement_batches: [],
      live_reports: [],
      live_tasks: [],
    });

    const result = await loadProjectReviewInput(client, {
      organizationId: "org-1",
      projectId: "p1",
    });

    expect(result!.input.finance.supplierCostCents).toBe(0);
    expect(result!.dataGaps).toContain("supplier_cost_unavailable");
  });
});
