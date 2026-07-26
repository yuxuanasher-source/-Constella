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
  selectCalls: Record<string, string[]> = {},
) {
  return {
    from: vi.fn((table: string) => {
      const rows = tables[table] ?? [];
      const chain: Record<string, unknown> = {};
      const track =
        (name: string) =>
        (...args: unknown[]) => {
          if (name === "select") {
            (selectCalls[table] ??= []).push(args[0] as string);
          }
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
            id: "report-1",
            live_task_id: "task-report-1",
            created_at: "2026-06-01T13:00:00.000Z",
            streamer_id: "s1",
            status: "approved",
            settlement_duration: 120,
            viewers: 4000,
            evidence_level: "green",
            risk_flags: [],
            streamers: { display_name: "Ava" },
            settlement_batch_items: [
              {
                id: "item-report-1",
                streamer_id: "s1",
                live_report_id: "report-1",
                computed_amount: 100,
                manual_amount: 0,
                adjustment_amount: 0,
                settlement_batches: {
                  organization_id: "org-1",
                  batch_type: "payable",
                  status: "confirmed",
                },
              },
            ],
            streamer_metrics: [
              {
                source_report_id: "report-1",
                metric_key: "gmv",
                metric_value: 200,
              },
            ],
          },
          {
            id: "report-2",
            live_task_id: "task-report-2",
            created_at: "2026-06-02T13:00:00.000Z",
            streamer_id: "s1",
            status: "approved",
            settlement_duration: 60,
            viewers: 1000,
            evidence_level: "yellow",
            risk_flags: ["duration_divergence"],
            streamers: { display_name: "Ava" },
            settlement_batch_items: [
              {
                id: "item-report-2",
                streamer_id: "s1",
                live_report_id: "report-2",
                computed_amount: 50,
                manual_amount: 0,
                adjustment_amount: 0,
                settlement_batches: {
                  organization_id: "org-1",
                  batch_type: "payable",
                  status: "locked",
                },
              },
            ],
            streamer_metrics: [
              {
                source_report_id: "report-2",
                metric_key: "gmv",
                metric_value: 100,
              },
            ],
          },
          {
            id: "report-3",
            live_task_id: "task-report-3",
            created_at: "2026-06-03T13:00:00.000Z",
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
      unknown: 0,
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
      roiBps: 20000,
      disputeCount: 0,
      grossMarginContributionCents: 4475,
    });
    expect(input.streamers.find((streamer) => streamer.id === "s2")).toBeUndefined();

    expect(dataGaps).toEqual(
      expect.arrayContaining([
        "project_category",
        "project_platform",
        "supplier_quality",
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
    expect(eqCalls.live_reports).toEqual(
      expect.arrayContaining([
        ["settlement_batch_items.organization_id", "org-1"],
        [
          "settlement_batch_items.settlement_batches.organization_id",
          "org-1",
        ],
        ["settlement_batch_item_reports.organization_id", "org-1"],
        [
          "settlement_batch_item_reports.settlement_batch_items.organization_id",
          "org-1",
        ],
        [
          "settlement_batch_item_reports.settlement_batch_items.settlement_batches.organization_id",
          "org-1",
        ],
        ["streamer_metrics.organization_id", "org-1"],
      ]),
    );
    expect(listOpsSettlementPool).not.toHaveBeenCalled();
  });

  it("uses the latest approved report per task and dedupes junction settlement items", async () => {
    const eqCalls: Record<string, EqCall[]> = {};
    const selectCalls: Record<string, string[]> = {};
    const sharedItem = {
      id: "item-shared",
      streamer_id: "s1",
      live_report_id: "report-new",
      computed_amount: 100,
      manual_amount: 0,
      adjustment_amount: 0,
      settlement_batches: {
        organization_id: "org-1",
        batch_type: "payable",
        status: "confirmed",
      },
    };
    const reportBase = {
      streamer_id: "s1",
      evidence_level: "green",
      risk_flags: [],
      streamers: { display_name: "Ava" },
    };
    const client = createClient(
      {
        projects: [project],
        settlement_batches: [
          {
            batch_type: "payable",
            status: "confirmed",
            period_start: "2026-06-01",
            period_end: "2026-06-30",
            computed_amount: 100,
            manual_amount: 0,
            adjustment_amount: 0,
          },
        ],
        live_reports: [
          {
            ...reportBase,
            id: "report-old",
            live_task_id: "task-1",
            status: "approved",
            created_at: "2026-06-01T10:00:00.000Z",
            settlement_duration: 60,
            viewers: 500,
            settlement_batch_items: [
              { ...sharedItem, id: "item-obsolete" },
            ],
            streamer_metrics: [
              {
                source_report_id: "report-old",
                metric_key: "gmv",
                metric_value: 100,
              },
            ],
          },
          {
            ...reportBase,
            id: "report-new",
            live_task_id: "task-1",
            status: "approved",
            created_at: "2026-06-01T11:00:00.000Z",
            settlement_duration: 120,
            viewers: 2000,
            settlement_batch_items: [sharedItem],
            settlement_batch_item_reports: [
              {
                settlement_batch_item_id: "item-shared",
                settlement_batch_items: sharedItem,
              },
            ],
            streamer_metrics: [
              {
                source_report_id: "report-new",
                metric_key: "gmv",
                metric_value: 200,
              },
            ],
          },
          {
            ...reportBase,
            id: "report-pending",
            live_task_id: "task-1",
            status: "pending",
            created_at: "2026-06-01T12:00:00.000Z",
            settlement_duration: null,
            viewers: null,
            settlement_batch_items: [],
            streamer_metrics: [],
          },
          {
            ...reportBase,
            id: "report-task-2",
            live_task_id: "task-2",
            status: "approved",
            created_at: "2026-06-02T10:00:00.000Z",
            settlement_duration: 60,
            viewers: 1000,
            settlement_batch_items: [],
            settlement_batch_item_reports: [
              {
                settlement_batch_item_id: "item-shared",
                settlement_batch_items: {
                  ...sharedItem,
                  id: "item-task-2",
                  streamer_id: "s1",
                  live_report_id: "report-task-2",
                },
              },
            ],
            streamer_metrics: [
              {
                source_report_id: "report-task-2",
                metric_key: "gmv",
                metric_value: 100,
              },
            ],
          },
        ],
        live_tasks: [],
      },
      eqCalls,
      selectCalls,
    );

    const result = await loadProjectReviewInput(client, {
      organizationId: "org-1",
      projectId: "p1",
    });

    expect(result?.input.streamers).toEqual([
      expect.objectContaining({
        id: "s1",
        durationMinutes: 180,
        totalViews: 3000,
        roiBps: 15000,
      }),
    ]);
    expect(selectCalls.live_reports?.[0]).toContain(
      "settlement_batch_items!settlement_batch_items_live_report_id_fkey",
    );
    expect(selectCalls.live_reports?.[0]).toContain(
      "settlement_batch_item_reports",
    );
    expect(selectCalls.live_reports?.[0]).toContain(
      "id, streamer_id, live_report_id, computed_amount",
    );
    expect(selectCalls.live_reports?.[0]).toContain("live_task_id");
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

  it("does not declare a streamer ROI gap when every approved report has real economics", async () => {
    const client = createClient({
      projects: [project],
      settlement_batches: [
        {
          batch_type: "payable",
          status: "confirmed",
          period_start: "2026-06-01",
          period_end: "2026-06-30",
          computed_amount: 100,
          manual_amount: 0,
          adjustment_amount: 0,
        },
      ],
      live_reports: [
        {
          id: "report-complete",
          live_task_id: "task-complete",
          created_at: "2026-06-01T10:00:00.000Z",
          streamer_id: "s1",
          status: "approved",
          settlement_duration: 60,
          viewers: 1000,
          evidence_level: "green",
          risk_flags: [],
          streamers: { display_name: "Ava" },
          settlement_batch_items: [
            {
              id: "item-complete",
              streamer_id: "s1",
              live_report_id: "report-complete",
              computed_amount: 100,
              manual_amount: 0,
              adjustment_amount: 0,
              settlement_batches: {
                organization_id: "org-1",
                batch_type: "payable",
                status: "confirmed",
              },
            },
          ],
          streamer_metrics: [
            {
              source_report_id: "report-complete",
              metric_key: "gmv",
              metric_value: 200,
            },
          ],
        },
      ],
      live_tasks: [
        {
          streamer_id: "s1",
          status: "completed",
          anomaly_flags: [],
          streamers: { display_name: "Ava" },
        },
      ],
    });

    const result = await loadProjectReviewInput(client, {
      organizationId: "org-1",
      projectId: "p1",
    });

    expect(result?.input.streamers[0].roiBps).toBe(20000);
    expect(result?.dataGaps).not.toContain("streamer_roi");
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
