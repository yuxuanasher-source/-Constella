import { describe, expect, it } from "vitest";

import {
  deriveAuthoritativeReportEconomics,
  selectAuthoritativeApprovedReports,
} from "./streamer-report-economics";

describe("selectAuthoritativeApprovedReports", () => {
  it("selects one latest approved report per live task with a stable id tie-break", () => {
    const selected = selectAuthoritativeApprovedReports([
      report({
        id: "report-old",
        live_task_id: "task-1",
        status: "approved",
        created_at: "2026-07-01T10:00:00Z",
      }),
      report({
        id: "report-approved",
        live_task_id: "task-1",
        status: "approved",
        created_at: "2026-07-01T11:00:00Z",
      }),
      report({
        id: "report-pending-newer",
        live_task_id: "task-1",
        status: "pending",
        created_at: "2026-07-01T12:00:00Z",
      }),
      report({
        id: "report-tie-a",
        live_task_id: "task-2",
        status: "approved",
        created_at: "2026-07-02T10:00:00Z",
      }),
      report({
        id: "report-tie-b",
        live_task_id: "task-2",
        status: "approved",
        created_at: "2026-07-02T10:00:00Z",
      }),
      report({
        id: "report-rejected",
        live_task_id: "task-3",
        status: "rejected",
        created_at: "2026-07-03T10:00:00Z",
      }),
    ]);

    expect(selected.map((item) => item.id)).toEqual([
      "report-approved",
      "report-tie-b",
    ]);
  });
});

describe("deriveAuthoritativeReportEconomics", () => {
  it("merges direct and junction items and counts shared item ids only once", () => {
    const linkedItem = settlementItem("item-linked", 50, {
      liveReportId: "report-2",
    });
    const directItem = settlementItem("item-direct", 100, {
      liveReportId: "report-1",
    });
    const economics = deriveAuthoritativeReportEconomics([
      report({
        id: "report-1",
        live_task_id: "task-1",
        settlement_duration: 60,
        viewers: 1000,
        settlement_batch_items: [directItem],
        settlement_batch_item_reports: [itemLink(directItem)],
        streamer_metrics: [gmv("report-1", 200)],
      }),
      report({
        id: "report-2",
        live_task_id: "task-2",
        settlement_duration: 120,
        viewers: 2000,
        settlement_batch_items: [],
        settlement_batch_item_reports: [itemLink(linkedItem)],
        streamer_metrics: [gmv("report-2", 100)],
      }),
    ], "org-1", "streamer-1");

    expect(economics.authoritativeReports.map((item) => item.id)).toEqual([
      "report-1",
      "report-2",
    ]);
    expect(economics.settlementItems).toEqual([
      { id: "item-direct", amount: 100 },
      { id: "item-linked", amount: 50 },
    ]);
    expect(economics.totalSettlementAmount).toBe(150);
    expect(economics.avgSessionMinutes).toBe(90);
    expect(economics.actualHourlyRate).toBe(50);
    expect(economics.totalGmvAmount).toBe(300);
    expect(economics.roiBps).toBe(20000);
    expect(economics.roi).toBe(2);
    expect(economics.viewsPerHour).toBe(1000);
  });

  it("keeps settlement economics missing when an authoritative report has no item coverage", () => {
    const economics = deriveAuthoritativeReportEconomics([
      report({
        id: "report-covered",
        live_task_id: "task-1",
        settlement_batch_items: [
          settlementItem("item-1", 100, {
            liveReportId: "report-covered",
          }),
        ],
        streamer_metrics: [gmv("report-covered", 100)],
      }),
      report({
        id: "report-uncovered",
        live_task_id: "task-2",
        settlement_batch_items: [],
        settlement_batch_item_reports: [],
        streamer_metrics: [gmv("report-uncovered", 100)],
      }),
    ], "org-1", "streamer-1");

    expect(economics.settlementItems).toBeNull();
    expect(economics.totalSettlementAmount).toBeNull();
    expect(economics.actualHourlyRate).toBeNull();
    expect(economics.roi).toBeNull();
    expect(economics.roiBps).toBeNull();
  });

  it("rejects partial settlement totals when a valid item is malformed", () => {
    const economics = deriveAuthoritativeReportEconomics([
      report({
        id: "report-1",
        live_task_id: "task-1",
        settlement_batch_items: [
          settlementItem("item-valid", 100, {
            liveReportId: "report-1",
          }),
          settlementItem("item-invalid", "not-a-number", {
            liveReportId: "report-1",
          }),
        ],
        streamer_metrics: [gmv("report-1", 200)],
      }),
    ], "org-1", "streamer-1");

    expect(economics.settlementItems).toBeNull();
    expect(economics.totalSettlementAmount).toBeNull();
    expect(economics.roi).toBeNull();
  });

  it("rejects one unallocated aggregate item for every linked streamer", () => {
    const aggregateItem = settlementItem("item-aggregate", 100, {
      streamerId: null,
      liveReportId: null,
    });
    const streamerA = deriveAuthoritativeReportEconomics(
      [
        report({
          id: "report-a",
          live_task_id: "task-a",
          settlement_batch_item_reports: [itemLink(aggregateItem)],
          streamer_metrics: [gmv("report-a", 200)],
        }),
      ],
      "org-1",
      "streamer-a",
    );
    const streamerB = deriveAuthoritativeReportEconomics(
      [
        report({
          id: "report-b",
          live_task_id: "task-b",
          settlement_batch_item_reports: [itemLink(aggregateItem)],
          streamer_metrics: [gmv("report-b", 200)],
        }),
      ],
      "org-1",
      "streamer-b",
    );

    for (const economics of [streamerA, streamerB]) {
      expect(economics.settlementItems).toBeNull();
      expect(economics.totalSettlementAmount).toBeNull();
      expect(economics.actualHourlyRate).toBeNull();
      expect(economics.roi).toBeNull();
      expect(economics.roiBps).toBeNull();
    }
  });
});

function report(overrides: Record<string, unknown>) {
  return {
    id: "report-default",
    live_task_id: "task-default",
    status: "approved",
    created_at: "2026-07-01T10:00:00Z",
    settlement_duration: 60,
    viewers: 1000,
    settlement_batch_items: [],
    settlement_batch_item_reports: [],
    streamer_metrics: [],
    ...overrides,
  };
}

function settlementItem(
  id: string,
  computedAmount: number | string,
  options: {
    streamerId?: string | null;
    liveReportId?: string | null;
  } = {},
) {
  return {
    id,
    streamer_id: options.streamerId ?? "streamer-1",
    live_report_id:
      options.liveReportId === undefined
        ? "report-default"
        : options.liveReportId,
    computed_amount: computedAmount,
    manual_amount: 0,
    adjustment_amount: 0,
    settlement_batches: {
      organization_id: "org-1",
      batch_type: "payable",
      status: "confirmed",
    },
  };
}

function itemLink(item: ReturnType<typeof settlementItem>) {
  return {
    settlement_batch_item_id: item.id,
    settlement_batch_items: item,
  };
}

function gmv(sourceReportId: string, value: number) {
  return {
    source_report_id: sourceReportId,
    metric_key: "gmv",
    metric_value: value,
  };
}
