import { describe, expect, it, vi } from "vitest";

import {
  buildReportSettlementExportRows,
  buildSettlementBatchExportRows,
} from "./settlement-export-data";

function createClient(results: Record<string, unknown[]>) {
  const queries: Record<string, ReturnType<typeof createQuery>> = {};
  const client = {
    from: vi.fn((table: string) => {
      const query = createQuery(results[table] ?? []);
      queries[table] = query;
      return query;
    }),
  };
  return { client, queries };
}

function createQuery(data: unknown[]) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    gte: vi.fn(() => query),
    lte: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    returns: vi.fn(async () => ({ data, error: null })),
  };
  return query;
}

describe("settlement export data", () => {
  it("builds settlement batch rows from server amounts and evidence snapshots", async () => {
    const { client, queries } = createClient({
      settlement_batches: [
        {
          id: "batch-1",
          batch_type: "payable",
          title: "六月主播应付",
          computed_amount: "160.25",
          manual_amount: "20",
          adjustment_amount: "-5",
          evidence_summary: { green: 1, yellow: 1, red: 0, unknown: 0 },
          projects: { name: "Project A" },
        },
      ],
      settlement_batch_items: [
        {
          settlement_batch_id: "batch-1",
          evidence_level: "yellow",
          evidence_snapshot: {
            legacyEngine: {
              rule: { settlementMethod: "base_salary_cpt" },
              breakdown: { computedAmount: 175.25 },
            },
          },
        },
      ],
    });

    const rows = await buildSettlementBatchExportRows({
      client,
      organizationId: "org-1",
      batchIds: ["batch-1"],
    });

    expect(rows).toEqual([
      {
        batchName: "六月主播应付",
        ruleLabel: "固定规则 · 底薪 + 时长计费",
        evidenceLevel: "绿 1 / 黄 1 / 红 0 / 未知 0",
        varianceFlag: "有差异",
        systemAmountCents: 16025,
        manualAmountCents: 2000,
        adjustmentAmountCents: -500,
        payableAmountCents: 17525,
        vendorReceivableCents: 0,
      },
    ]);
    expect(queries.settlement_batches.in).toHaveBeenCalledWith("id", [
      "batch-1",
    ]);
    expect(queries.settlement_batch_items.in).toHaveBeenCalledWith(
      "settlement_batch_id",
      ["batch-1"],
    );
  });

  it("builds report settlement rows from linked settlement items instead of browser-calculated amounts", async () => {
    const { client, queries } = createClient({
      live_reports: [
        {
          id: "report-1",
          settlement_duration: 120,
          system_duration: 120,
          evidence_level: "green",
          created_at: "2026-06-02T12:00:00.000Z",
          settled_batch_item_id: "item-1",
          projects: { name: "Project A", product_name: "Game A" },
          streamers: { display_name: "Streamer A" },
          live_tasks: {
            planned_start_at: "2026-06-02T20:00:00.000Z",
            planned_end_at: "2026-06-02T22:00:00.000Z",
          },
        },
      ],
      settlement_batch_items: [
        {
          id: "item-1",
          computed_amount: "160",
          manual_amount: "25.5",
          adjustment_amount: "-5",
          evidence_snapshot: {
            legacyEngine: {
              rule: { hourlyRate: 80 },
              breakdown: { computedAmount: 160 },
            },
          },
        },
      ],
      report_screenshots: [
        { live_report_id: "report-1" },
        { live_report_id: "report-1" },
      ],
    });

    const rows = await buildReportSettlementExportRows({
      client,
      organizationId: "org-1",
      organizationName: "星辰公会",
      reportIds: ["report-1"],
    });

    expect(rows).toEqual([
      {
        reportId: "report-1",
        guildOrIndividual: "星辰公会",
        gameProduct: "Game A",
        streamerName: "Streamer A",
        liveDate: "2026-06-02",
        liveTime: "20:00-22:00",
        duration: "2 小时",
        hourlyRate: "¥80",
        talentFee: "¥180.50",
        screenshot: "2 张",
      },
    ]);
    expect(queries.live_reports.in).toHaveBeenCalledWith("id", ["report-1"]);
    expect(queries.settlement_batch_items.in).toHaveBeenCalledWith("id", [
      "item-1",
    ]);
  });

  it("does not invent a talent fee for reports without a settled batch item", async () => {
    const { client } = createClient({
      live_reports: [
        {
          id: "report-unsettled",
          settlement_duration: 90,
          created_at: "2026-06-03T12:00:00.000Z",
          settled_batch_item_id: null,
          projects: { name: "Project B", product_name: "Game B" },
          streamers: { display_name: "Streamer B" },
          live_tasks: null,
        },
      ],
      report_screenshots: [],
    });

    const rows = await buildReportSettlementExportRows({
      client,
      organizationId: "org-1",
      organizationName: "星辰公会",
      reportIds: ["report-unsettled"],
    });

    expect(rows[0]).toMatchObject({
      reportId: "report-unsettled",
      duration: "1.5 小时",
      hourlyRate: "—",
      talentFee: "—",
    });
  });
});
