import { describe, expect, it, vi } from "vitest";

import { getStreamerLifecycleOverview } from "./streamer-lifecycle-queries";

describe("getStreamerLifecycleOverview", () => {
  it("selects and maps average duration and real economics", async () => {
    const streamers = queryBuilder([
      {
        id: "streamer-1",
        display_name: "主播一",
        lifecycle_stage: "active",
        rating: "a",
        operation_tier: "core",
        operation_tags: [],
        contract_start_date: null,
        contract_end_date: null,
        revenue_share_bps: null,
      },
    ]);
    const snapshots = queryBuilder([
      {
        streamer_id: "streamer-1",
        period_end: "2026-07-31",
        broadcast_rate_bps: 10000,
        avg_session_minutes: "90.00",
        avg_session_revenue_amount: "150.00",
        total_revenue_amount: "300.00",
        total_settlement_amount: "200.00",
        actual_hourly_rate: "66.67",
        total_gmv_amount: "600.00",
        roi_bps: 30000,
        views_per_hour: "1000.00",
        live_sessions: 2,
        computed_at: "2026-08-01T00:00:00Z",
      },
    ]);
    const empty = queryBuilder([]);
    const from = vi.fn((table: string) => {
      if (table === "streamers") return streamers;
      if (table === "streamer_performance_snapshots") return snapshots;
      return empty;
    });

    const result = await getStreamerLifecycleOverview({ from } as never);

    expect(result.streamers[0]).toMatchObject({
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

function queryBuilder(data: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  return builder;
}
