import { describe, expect, it } from "vitest";

import { toOpsLiveReportQueueItem } from "@/features/live-operations/live-operations-queries";
import {
  toOpsSettlementBatchDetailItem,
  toOpsSettlementBatchListItem,
  toOpsSettlementPoolItem,
} from "@/features/settlements/settlement-queries";
import {
  toStreamerEarningsSummary,
  type StreamerPayableSafeRow,
} from "@/features/settlements/streamer-settlement-queries";

const forbiddenFieldPatterns = [
  /_/,
  /receivable/i,
  /gross/i,
  /cost/i,
  /vendorPrice/i,
  /vendorUnitPrice/i,
  /supplierPrice/i,
];

describe("api DTO contracts", () => {
  it("keeps the M5 ops report queue DTO camelCase and amount-free", () => {
    const item = toOpsLiveReportQueueItem({
      id: "report-1",
      status: "pending_review",
      settlement_duration: 120,
      time_source: "system",
      evidence_level: "green",
      viewers: 900,
      created_at: "2026-06-02T12:00:00.000Z",
      live_tasks: { title: "Launch Week 路 Streamer One" },
      projects: { name: "Launch Week" },
      streamers: { display_name: "Streamer One" },
    });

    expectPublicDtoShape(item);
    expect(JSON.stringify(item)).not.toMatch(/amount/i);
  });

  it("keeps the M6 ops settlement DTOs camelCase and free of sensitive financial fields", () => {
    const poolItem = toOpsSettlementPoolItem({
      id: "report-1",
      created_at: "2026-06-02T12:00:00.000Z",
      settlement_duration: 120,
      time_source: "system",
      evidence_level: "green",
      projects: { name: "Launch Week" },
      streamers: { display_name: "Streamer One" },
      project_streamers: [
        {
          settlement_method: "cpt",
          hourly_rate: 80,
          base_salary: 0,
        },
      ],
    });
    const batchItem = toOpsSettlementBatchListItem({
      id: "batch-1",
      project_id: "project-1",
      batch_type: "payable",
      status: "generated",
      period_start: "2026-06-01",
      period_end: "2026-06-30",
      computed_amount: 160,
      manual_amount: 0,
      adjustment_amount: 0,
      evidence_summary: {
        green: 1,
        report_ids: ["report-1"],
      },
      updated_at: "2026-06-02T12:30:00.000Z",
      created_by: "user-owner",
      projects: { name: "Launch Week" },
      settlement_batch_items: [{ id: "item-1" }],
    });
    const detailItem = toOpsSettlementBatchDetailItem({
      id: "item-1",
      settlement_batch_id: "batch-1",
      item_type: "live_report",
      computed_amount: 160,
      manual_amount: 0,
      adjustment_amount: 0,
      evidence_level: "green",
      evidence_snapshot: {
        settlementDuration: 120,
        timeSource: "system",
        report_id: "report-1",
      },
      streamers: { display_name: "Streamer One" },
    });

    expectPublicDtoShape([poolItem, batchItem, detailItem]);
  });

  it("keeps the streamer settlement DTO on the payable-safe boundary", () => {
    const rows: StreamerPayableSafeRow[] = [
      {
        id: "item-1",
        project_name: "Launch Week",
        period_start: "2026-06-01",
        period_end: "2026-06-30",
        computed_amount: 160,
        manual_amount: 0,
        adjustment_amount: 0,
        payable_amount: 160,
        evidence_level: "green",
        evidence_snapshot: {
          settlementDuration: 120,
          timeSource: "system",
          report_id: "report-1",
        },
        created_at: "2026-06-02T12:00:00.000Z",
      },
    ];

    const summary = toStreamerEarningsSummary(rows, {
      currentMonth: "2026-06",
    });

    expectPublicDtoShape(summary);
  });
});

function expectPublicDtoShape(value: unknown): void {
  for (const key of collectObjectKeys(value)) {
    for (const pattern of forbiddenFieldPatterns) {
      expect(key, `forbidden DTO key "${key}"`).not.toMatch(pattern);
    }
  }
}

function collectObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectObjectKeys);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => [
    key,
    ...collectObjectKeys(nestedValue),
  ]);
}
