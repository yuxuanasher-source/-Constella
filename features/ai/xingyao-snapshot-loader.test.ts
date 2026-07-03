import { describe, expect, it } from "vitest";

import {
  loadXingyaoFeatureStore,
  loadXingyaoFeatureStoreInput,
  resolveXingyaoPeriods,
  type XingyaoSnapshotClient,
} from "./xingyao-snapshot-loader";

const NOW = "2026-07-03T12:00:00+08:00";

function fakeClient(
  rows: Record<string, Record<string, unknown>[]>,
  failingTables: string[] = [],
): XingyaoSnapshotClient {
  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        limit: async () => {
          if (failingTables.includes(table)) {
            return { data: null, error: new Error("query failed") };
          }
          return { data: rows[table] ?? [], error: null };
        },
      };
      return builder;
    },
  };
}

function canonicalRows(): Record<string, Record<string, unknown>[]> {
  return {
    projects: [
      {
        id: "p1",
        name: "天使之战",
        status: "recruiting",
        default_hourly_rate: 100,
      },
    ],
    live_tasks: [
      {
        id: "t1",
        project_id: "p1",
        streamer_id: "s1",
        status: "report_approved",
        planned_start_at: "2026-07-01T20:30:00+08:00",
        planned_duration: 120,
        system_started_at: "2026-07-01T20:31:00+08:00",
      },
      {
        id: "t2",
        project_id: "p1",
        streamer_id: "s1",
        status: "pending_live",
        planned_start_at: "2026-07-02T20:10:00+08:00",
        planned_duration: 60,
        system_started_at: null,
      },
      {
        id: "t3",
        project_id: "p1",
        streamer_id: "s1",
        status: "completed",
        planned_start_at: "2026-06-15T20:00:00+08:00",
        planned_duration: 60,
        system_started_at: "2026-06-15T20:01:00+08:00",
      },
      {
        id: "t4",
        project_id: "p1",
        streamer_id: "s1",
        status: "pending_live",
        planned_start_at: "2026-07-20T20:00:00+08:00",
        planned_duration: 60,
        system_started_at: null,
      },
    ],
    live_reports: [
      {
        id: "r1",
        project_id: "p1",
        streamer_id: "s1",
        status: "approved",
        settlement_duration: 120,
        evidence_level: "green",
        viewers: 1000,
        risk_flags: ["duration_divergence"],
        created_at: "2026-07-01T23:00:00+08:00",
      },
      {
        id: "r2",
        project_id: "p1",
        streamer_id: "s1",
        status: "approved",
        settlement_duration: 60,
        evidence_level: "yellow",
        viewers: 2000,
        risk_flags: [],
        created_at: "2026-06-15T23:00:00+08:00",
      },
    ],
    streamers: [
      {
        id: "s1",
        display_name: "小美",
        auto_trust: "probation",
        clean_report_count: 2,
      },
    ],
    project_streamers: [
      {
        project_id: "p1",
        streamer_id: "s1",
        status: "joined",
        hourly_rate: 50,
      },
    ],
    platform_accounts: [
      {
        id: "a1",
        platform: "douyin",
        account_uid: "uid-001",
        status: "frozen",
        bound_streamer_id: "s1",
      },
    ],
    project_cost_items: [
      {
        project_id: "p1",
        streamer_id: null,
        item_type: "traffic",
        amount_cents: 30_000,
        direction: "cost",
        status: "confirmed",
        created_at: "2026-07-02T10:00:00+08:00",
      },
      {
        project_id: "p1",
        streamer_id: "s1",
        item_type: "cps",
        amount_cents: 50_000,
        direction: "revenue_offset",
        status: "confirmed",
        created_at: "2026-07-02T11:00:00+08:00",
      },
      {
        project_id: "p1",
        streamer_id: null,
        item_type: "supplier_fee",
        amount_cents: 20_000,
        direction: "cost",
        status: "confirmed",
        created_at: "2026-06-10T10:00:00+08:00",
      },
    ],
    settlement_batches: [
      {
        id: "b1",
        project_id: "p1",
        batch_type: "receivable",
        status: "pending",
        period_end: "2026-05-31",
        computed_amount: 1000,
        manual_amount: null,
        adjustment_amount: 0,
      },
      {
        id: "b2",
        project_id: "p1",
        batch_type: "payable",
        status: "pending",
        period_end: "2026-06-30",
        computed_amount: 500,
        manual_amount: null,
        adjustment_amount: 0,
      },
      {
        id: "b3",
        project_id: "p1",
        batch_type: "receivable",
        status: "locked",
        period_end: "2026-04-30",
        computed_amount: 800,
        manual_amount: null,
        adjustment_amount: 0,
      },
    ],
    knowledge_documents: [
      { id: "k1", doc_type: "playbook" },
      { id: "k2", doc_type: "sop" },
    ],
    recording_ai_analyses: [
      { id: "ra1", status: "succeeded", risk_flags: ["low_light"] },
      { id: "ra2", status: "succeeded", risk_flags: [] },
    ],
  };
}

describe("resolveXingyaoPeriods", () => {
  it("resolves current/previous months and elapsed ratio in Asia/Shanghai", () => {
    const periods = resolveXingyaoPeriods(NOW);
    expect(periods.current.label).toBe("2026-07");
    expect(periods.previous.label).toBe("2026-06");
    expect(periods.periodElapsedRatioBps).toBe(968);
    expect(periods.fetchSince).toBe("2026-06-01T00:00:00+08:00");
  });

  it("rolls the previous period across the year boundary", () => {
    const periods = resolveXingyaoPeriods("2026-01-10T12:00:00+08:00");
    expect(periods.previous.label).toBe("2025-12");
  });
});

describe("loadXingyaoFeatureStoreInput", () => {
  it("aggregates six modules into feature store slices", async () => {
    const input = await loadXingyaoFeatureStoreInput({
      client: fakeClient(canonicalRows()),
      organizationId: "org-1",
      now: NOW,
    });

    expect(input.periodLabel).toBe("2026-07");
    expect(input.periodElapsedRatioBps).toBe(968);

    const project = input.projects[0];
    expect(project).toMatchObject({
      id: "p1",
      name: "天使之战",
      receivableCents: 20_000,
      previousReceivableCents: 10_000,
      payableCents: 10_000,
      paidTrafficCostCents: 30_000,
      otherCostCents: 0,
      scheduledSessions: 2,
      startedSessions: 1,
      greenEvidenceSessions: 1,
      viewership: 1000,
      previousViewership: 2000,
      conversionGmvCents: 50_000,
      streamerIds: ["s1"],
      accountIds: ["a1"],
    });

    const streamer = input.streamers[0];
    expect(streamer).toMatchObject({
      id: "s1",
      name: "小美",
      projectIds: ["p1"],
      scheduledSessions: 2,
      startedSessions: 1,
      previousScheduledSessions: 1,
      previousStartedSessions: 1,
      avgDailyScheduledMinutes: 60,
      testPassed: false,
      trainingCompletedRatioBps: 4_000,
      absenceCount30d: 1,
      consecutiveAbsences: 1,
      recentAbsenceDates: ["2026-07-02"],
      viewership: 1000,
      conversionGmvCents: 50_000,
      incomeCents: 10_000,
      previousIncomeCents: 5_000,
      disputeCount: 1,
      daysSinceLastLive: 2,
    });

    expect(input.accounts[0]).toMatchObject({
      id: "a1",
      platform: "douyin",
      handle: "uid-001",
      status: "frozen",
      projectIds: ["p1"],
    });

    expect(input.timeslots).toEqual([
      expect.objectContaining({
        projectId: "p1",
        hourOfDay: 20,
        scheduledSessions: 2,
        startedSessions: 1,
      }),
    ]);

    // 只保留未锁定的应收批次；账期代理为期末后一个月。
    expect(input.settlements).toEqual([
      expect.objectContaining({
        id: "b1",
        counterparty: "天使之战",
        amountCents: 100_000,
        dueInDays: -3,
      }),
    ]);

    expect(input.knowledge).toEqual({ documentCount: 2, playbookCount: 1 });
    expect(input.recordings).toEqual({
      analysisCount: 2,
      highRiskCount: 1,
      riskFlags: ["low_light"],
    });
  });

  it("degrades a failing module to an empty slice instead of throwing", async () => {
    const input = await loadXingyaoFeatureStoreInput({
      client: fakeClient(canonicalRows(), ["platform_accounts"]),
      organizationId: "org-1",
      now: NOW,
    });

    expect(input.accounts).toEqual([]);
    expect(input.projects).toHaveLength(1);
  });
});

describe("loadXingyaoFeatureStore", () => {
  it("returns a ready-to-diagnose store with coverage flags", async () => {
    const store = await loadXingyaoFeatureStore({
      client: fakeClient(canonicalRows(), ["platform_accounts"]),
      organizationId: "org-1",
      now: NOW,
    });

    expect(store.projects[0].broadcastRateBps).toBe(5_000);
    expect(store.coverage).toEqual(
      expect.arrayContaining([
        { module: "projects", available: true },
        { module: "accounts", available: false },
      ]),
    );
    expect(store.missingData.join(" ")).toContain("账号库数据");
  });
});
