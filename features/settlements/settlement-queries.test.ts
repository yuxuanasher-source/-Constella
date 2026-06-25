import { describe, expect, it, vi } from "vitest";

import {
  listOpsSettlementBatches,
  listOpsSettlementBatchDetails,
  toOpsSettlementBatchCostDetailItem,
  toOpsSettlementBatchDetailItem,
  toOpsSettlementBatchListItem,
  toOpsSettlementPoolItem,
  toStreamerSafeSettlementBatchDetailItems,
} from "./settlement-queries";
import {
  toOpsReferenceBatch,
  toOpsReferenceBatchDetailItem,
  toOpsReferenceSettlementPoolItem,
} from "./settlement-ui-adapters";

function createSettlementQueryClient(data: unknown[] = []) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    not: vi.fn(() => query),
    order: vi.fn(() => query),
    returns: vi.fn(async () => ({ data, error: null })),
  };
  const client = {
    from: vi.fn(() => query),
  };

  return { client, query };
}

describe("settlement DTO mappers", () => {
  it("scopes ops settlement batch lists to the active organization", async () => {
    const { client, query } = createSettlementQueryClient();

    await listOpsSettlementBatches(client as never, "org-1");

    expect(client.from).toHaveBeenCalledWith("settlement_batches");
    expect(query.eq).toHaveBeenCalledWith("organization_id", "org-1");
  });

  it("scopes ops settlement batch details to the active organization and selected batch", async () => {
    const { client, query } = createSettlementQueryClient();

    await listOpsSettlementBatchDetails(client as never, {
      organizationId: "org-1",
      batchId: "batch-1",
    });

    expect(client.from).toHaveBeenCalledWith("settlement_batch_items");
    expect(query.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(query.eq).toHaveBeenCalledWith("settlement_batch_id", "batch-1");
  });

  it("maps settlement pool rows with frozen evidence and rule preview", () => {
    const item = toOpsSettlementPoolItem({
      id: "report-1",
      project_id: "project-1",
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
          cps_rate_bps: 0,
        },
      ],
    });

    expect(item).toEqual({
      id: "report-1",
      projectId: "project-1",
      projectName: "Launch Week",
      streamerName: "Streamer One",
      settlementDuration: 120,
      timeSource: "system",
      evidenceLevel: "green",
      settlementMethod: "cpt",
      cpsRateBps: 0,
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
      project_id: "project-1",
      projects: { name: "Launch Week" },
      settlement_batch_items: [{ id: "item-1" }],
    });

    expect(item.totalAmount).toBe(175);
    expect(toOpsReferenceBatch(item)).toEqual({
      id: "batch-1",
      projectId: "project-1",
      type: "streamer_payable",
      name: "Launch Week · 主播应付",
      project: "Launch Week",
      vendor: "—",
      period: "2026-06-01 → 2026-06-30",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      items: 1,
      amount: 175,
      status: "generated",
      updated: "2026-06-02 20:10",
      creator: "user-owner",
    });
  });

  it("maps batch detail rows into reference detail rows", () => {
    const liveReportItem = toOpsSettlementBatchDetailItem({
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
      },
      streamers: { display_name: "Streamer One" },
    });
    const manualItem = toOpsSettlementBatchDetailItem({
      id: "item-2",
      settlement_batch_id: "batch-1",
      item_type: "cpa",
      computed_amount: 0,
      manual_amount: 300,
      adjustment_amount: 20,
      evidence_level: "red",
      evidence_snapshot: {
        source: "manual",
        reason: "Imported CPA claim",
      },
      streamers: null,
    });

    expect(liveReportItem).toMatchObject({
      batchId: "batch-1",
      streamerName: "Streamer One",
      settlementDuration: 120,
      systemAmount: 160,
      manualAmount: 0,
    });
    expect(toOpsReferenceBatchDetailItem(liveReportItem)).toEqual({
      streamer: "Streamer One",
      id: "item-1",
      rule: "系统核验 CPT/底薪",
      hours: 2,
      qty: "green · system",
      base: 0,
      variable: 160,
      adjust: 0,
      total: 160,
    });
    expect(toOpsReferenceBatchDetailItem(manualItem)).toEqual({
      streamer: "人工承载",
      id: "item-2",
      rule: "CPA 人工承载",
      hours: 0,
      qty: "red · manual",
      base: 0,
      variable: 300,
      adjust: 20,
      total: 320,
    });
  });

  it("maps project cost items for staff and hides them from streamer-safe details", () => {
    const costItem = toOpsSettlementBatchCostDetailItem({
      id: "cost-1",
      settlement_batch_id: "batch-1",
      item_type: "supplier_fee",
      amount_cents: 12000,
      direction: "cost",
      evidence_level: "yellow",
      source: "manual",
      reason: "Supplier bill confirmed.",
    });

    expect(costItem).toMatchObject({
      id: "cost-1",
      batchId: "batch-1",
      itemType: "supplier_fee",
      internalOnly: true,
      manualAmount: 12000,
      totalAmount: 12000,
    });
    expect(toStreamerSafeSettlementBatchDetailItems([costItem])).toEqual([]);
  });

  it("maps settlement pool rows into reference pool rows without computed settlement side effects", () => {
    const poolItem = toOpsSettlementPoolItem({
      id: "report-2",
      project_id: "project-1",
      created_at: "2026-06-02T12:30:00.000Z",
      settlement_duration: 90,
      time_source: "system",
      evidence_level: "green",
      projects: { name: "Launch Week" },
      streamers: { display_name: "Streamer Two" },
      project_streamers: [
        {
          settlement_method: "cpt",
          hourly_rate: 100,
          base_salary: 0,
          cps_rate_bps: 0,
        },
      ],
    });

    expect(toOpsReferenceSettlementPoolItem(poolItem)).toEqual({
      id: "report-2",
      projectId: "project-1",
      streamer: "Streamer Two",
      project: "Launch Week",
      hours: 1.5,
      evidence: "green · system",
      rule: "cpt",
      expected: 150,
      approvedAt: "2026-06-02 20:30",
    });
  });
});
