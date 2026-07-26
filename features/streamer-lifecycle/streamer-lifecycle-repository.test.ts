import { describe, expect, it, vi } from "vitest";

import { SupabaseStreamerLifecycleRepository } from "./streamer-lifecycle-repository";

describe("SupabaseStreamerLifecycleRepository performance source", () => {
  it("loads report-scoped GMV and sums only payable confirmed or locked items", async () => {
    const tasks = queryBuilder([
      {
        id: "task-1",
        status: "completed",
        planned_start_at: "2026-07-01T12:00:00Z",
        system_started_at: "2026-07-01T12:00:00Z",
        system_duration: 120,
        live_reports: [
          {
            id: "report-old",
            live_task_id: "task-1",
            created_at: "2026-07-01T13:00:00Z",
            settlement_duration: 60,
            viewers: 500,
            status: "approved",
          },
          {
            id: "report-1",
            live_task_id: "task-1",
            created_at: "2026-07-01T14:00:00Z",
            settlement_duration: 120,
            viewers: 3000,
            status: "approved",
          },
          {
            id: "report-pending",
            live_task_id: "task-1",
            created_at: "2026-07-01T15:00:00Z",
            settlement_duration: null,
            viewers: null,
            status: "pending",
          },
        ],
        projects: { default_hourly_rate: 100 },
      },
    ]);
    const settlementItems = queryBuilder([
      settlementItem("report-1", 100, 10, -5, "payable", "confirmed"),
      settlementItem("report-1", 50, 0, 0, "payable", "locked"),
      settlementItem("report-1", 999, 0, 0, "payable", "draft"),
      settlementItem("report-1", 999, 0, 0, "receivable", "confirmed"),
    ]);
    const settlementLinks = queryBuilder([
      {
        live_report_id: "report-1",
        settlement_batch_item_id: "item-aggregate",
        settlement_batch_items: {
          id: "item-aggregate",
          streamer_id: "streamer-1",
          live_report_id: "report-1",
          computed_amount: 25,
          manual_amount: 0,
          adjustment_amount: 0,
          settlement_batches: {
            organization_id: "org-1",
            batch_type: "payable",
            status: "confirmed",
          },
        },
      },
    ]);
    const metrics = queryBuilder([
      {
        source_report_id: "report-1",
        metric_key: "gmv",
        metric_value: Number.NaN,
        recorded_at: "2026-07-01T15:00:00Z",
      },
      {
        source_report_id: "report-1",
        metric_key: "gmv",
        metric_value: 600,
        recorded_at: "2026-07-01T14:00:00Z",
      },
      {
        source_report_id: "report-1",
        metric_key: "viewers",
        metric_value: 9999,
        recorded_at: "2026-07-01T14:00:00Z",
      },
    ]);
    const from = vi.fn((table: string) => {
      if (table === "live_tasks") return tasks;
      if (table === "settlement_batch_items") return settlementItems;
      if (table === "settlement_batch_item_reports") return settlementLinks;
      if (table === "streamer_metrics") return metrics;
      throw new Error(`unexpected table ${table}`);
    });
    const repo = new SupabaseStreamerLifecycleRepository({
      from,
    } as never);

    const result = await repo.listPerformanceSourceTasks(
      "org-1",
      "streamer-1",
      "2026-07-01",
      "2026-07-31",
    );

    expect(result).toEqual([
      expect.objectContaining({
        taskId: "task-1",
        settlementDuration: 120,
        settlementItems: [
          expect.objectContaining({ amount: 105 }),
          expect.objectContaining({ amount: 50 }),
          { id: "item-aggregate", amount: 25 },
        ],
        attributedGmvAmount: 600,
      }),
    ]);
    expect(settlementItems.in).toHaveBeenCalledWith("live_report_id", [
      "report-1",
    ]);
    expect(settlementItems.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(settlementItems.eq).toHaveBeenCalledWith(
      "streamer_id",
      "streamer-1",
    );
    expect(settlementItems.eq).toHaveBeenCalledWith(
      "settlement_batches.organization_id",
      "org-1",
    );
    expect(settlementItems.eq).toHaveBeenCalledWith(
      "settlement_batches.batch_type",
      "payable",
    );
    expect(settlementItems.in).toHaveBeenCalledWith(
      "settlement_batches.status",
      ["confirmed", "locked"],
    );
    expect(metrics.eq).toHaveBeenCalledWith("metric_key", "gmv");
    expect(metrics.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(metrics.eq).toHaveBeenCalledWith("streamer_id", "streamer-1");
    expect(metrics.in).toHaveBeenCalledWith("source_report_id", ["report-1"]);
    expect(settlementLinks.in).toHaveBeenCalledWith("live_report_id", [
      "report-1",
    ]);
    expect(settlementLinks.eq).toHaveBeenCalledWith(
      "settlement_batch_items.streamer_id",
      "streamer-1",
    );
  });

  it("keeps economics missing when the picked report has no valid rows", async () => {
    const tasks = queryBuilder([
      {
        id: "task-1",
        status: "completed",
        planned_start_at: "2026-07-01T12:00:00Z",
        system_started_at: "2026-07-01T12:00:00Z",
        system_duration: 60,
        live_reports: [
          {
            id: "report-1",
            live_task_id: "task-1",
            created_at: "2026-07-01T14:00:00Z",
            settlement_duration: 60,
            viewers: 0,
            status: "approved",
          },
        ],
        projects: null,
      },
    ]);
    const from = vi.fn((table: string) => {
      if (table === "live_tasks") return tasks;
      return queryBuilder([]);
    });
    const repo = new SupabaseStreamerLifecycleRepository({
      from,
    } as never);

    const [result] = await repo.listPerformanceSourceTasks(
      "org-1",
      "streamer-1",
      "2026-07-01",
      "2026-07-31",
    );

    expect(result.settlementItems).toBeNull();
    expect(result.attributedGmvAmount).toBeNull();
  });

  it("rejects settlement evidence from a batch in another organization", async () => {
    const tasks = queryBuilder([
      {
        id: "task-1",
        status: "completed",
        planned_start_at: "2026-07-01T12:00:00Z",
        system_started_at: "2026-07-01T12:00:00Z",
        system_duration: 60,
        live_reports: [
          {
            id: "report-1",
            live_task_id: "task-1",
            created_at: "2026-07-01T14:00:00Z",
            settlement_duration: 60,
            viewers: 1000,
            status: "approved",
          },
        ],
        projects: null,
      },
    ]);
    const settlementItems = queryBuilder([
      settlementItem("report-1", 100, 0, 0, "payable", "confirmed"),
      settlementItem(
        "report-1",
        50,
        0,
        0,
        "payable",
        "locked",
        "org-other",
      ),
    ]);
    const from = vi.fn((table: string) => {
      if (table === "live_tasks") return tasks;
      if (table === "settlement_batch_items") return settlementItems;
      return queryBuilder([]);
    });
    const repo = new SupabaseStreamerLifecycleRepository({
      from,
    } as never);

    const [result] = await repo.listPerformanceSourceTasks(
      "org-1",
      "streamer-1",
      "2026-07-01",
      "2026-07-31",
    );

    expect(result.settlementItems).toBeNull();
  });

  it("maps persisted average duration and real economics from snapshots", async () => {
    const snapshots = queryBuilder([
      {
        id: "snapshot-1",
        streamer_id: "streamer-1",
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        scheduled_sessions: 2,
        live_sessions: 2,
        completed_sessions: 2,
        broadcast_rate_bps: 10000,
        total_live_minutes: 180,
        avg_session_minutes: "90.00",
        total_revenue_amount: "300.00",
        avg_session_revenue_amount: "150.00",
        total_settlement_amount: "200.00",
        actual_hourly_rate: "66.67",
        total_gmv_amount: "600.00",
        roi_bps: 30000,
        views_per_hour: "1000.00",
        total_viewers: 3000,
        avg_session_viewers: 1500,
        computed_at: "2026-08-01T00:00:00Z",
      },
    ]);
    const repo = new SupabaseStreamerLifecycleRepository({
      from: vi.fn(() => snapshots),
    } as never);

    const result = await repo.getLatestPerformanceSnapshot("streamer-1");

    expect(result).toMatchObject({
      avgSessionMinutes: 90,
      totalSettlementAmount: 200,
      actualHourlyRate: 66.67,
      totalGmvAmount: 600,
      roiBps: 30000,
      viewsPerHour: 1000,
    });
    expect(snapshots.select).toHaveBeenCalledWith(
      expect.stringContaining("avg_session_minutes"),
    );
    expect(snapshots.select).toHaveBeenCalledWith(
      expect.stringContaining("views_per_hour"),
    );
  });
});

function settlementItem(
  liveReportId: string,
  computedAmount: number | string,
  manualAmount: number,
  adjustmentAmount: number,
  batchType: string,
  status: string,
  organizationId = "org-1",
) {
  return {
    id: [
      liveReportId,
      computedAmount,
      manualAmount,
      adjustmentAmount,
      batchType,
      status,
    ].join(":"),
    streamer_id: "streamer-1",
    live_report_id: liveReportId,
    computed_amount: computedAmount,
    manual_amount: manualAmount,
    adjustment_amount: adjustmentAmount,
    settlement_batches: {
      organization_id: organizationId,
      batch_type: batchType,
      status,
    },
  };
}

function queryBuilder(data: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  return builder;
}
