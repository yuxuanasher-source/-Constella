import { describe, expect, it } from "vitest";

import {
  toOpsSettlementBatchListItem,
  toOpsSettlementPoolItem,
} from "./settlement-queries";
import { toOpsReferenceBatch } from "./settlement-ui-adapters";

describe("settlement DTO mappers", () => {
  it("maps settlement pool rows with frozen evidence and rule preview", () => {
    const item = toOpsSettlementPoolItem({
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

    expect(item).toEqual({
      id: "report-1",
      projectName: "Launch Week",
      streamerName: "Streamer One",
      settlementDuration: 120,
      timeSource: "system",
      evidenceLevel: "green",
      settlementMethod: "cpt",
      expectedAmount: 160,
      approvedAt: "2026-06-02T12:00:00.000Z",
    });
  });

  it("maps ops batches and reference batches without changing visual component shape", () => {
    const item = toOpsSettlementBatchListItem({
      id: "batch-1",
      batch_type: "payable",
      status: "generated",
      period_start: "2026-06-01",
      period_end: "2026-06-30",
      computed_amount: 160,
      manual_amount: 20,
      adjustment_amount: -5,
      evidence_summary: { green: 1 },
      updated_at: "2026-06-02T12:10:00.000Z",
      created_by: "user-owner",
      projects: { name: "Launch Week" },
      settlement_batch_items: [{ id: "item-1" }],
    });

    expect(item.totalAmount).toBe(175);
    expect(toOpsReferenceBatch(item)).toEqual({
      id: "batch-1",
      type: "streamer_payable",
      name: "Launch Week · 主播应付",
      project: "Launch Week",
      vendor: "—",
      period: "2026-06-01 → 2026-06-30",
      items: 1,
      amount: 175,
      status: "generated",
      updated: "2026-06-02 20:10",
      creator: "user-owner",
    });
  });
});
