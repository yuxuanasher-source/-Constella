import { describe, expect, it, vi } from "vitest";

import {
  type FinanceBatchAdjustmentRow,
  type FinanceBatchItemRow,
  type FinanceBatchRow,
  SupabaseFinanceBatchRepository,
  toFinanceBatchAdjustmentRecord,
  toFinanceBatchItemRecord,
  toFinanceBatchRecord,
} from "./finance-batch-repository";

const batchRow = {
  id: "batch-1",
  organization_id: "org-1",
  batch_type: "streamer_payable",
  title: "July streamer payable",
  period_start: "2026-07-01",
  period_end: "2026-07-31",
  status: "draft",
  has_exceptions: false,
  system_amount: "210.00",
  adjustment_amount: "0.00",
  final_amount: "210.00",
  item_count: 2,
  exception_count: 0,
  created_by: "user-owner",
  status_reason: null,
  metadata: { source: "test" },
  created_at: "2026-07-16T12:00:00.000Z",
  updated_at: "2026-07-16T12:00:00.000Z",
} satisfies FinanceBatchRow;

const itemRow = {
  id: "item-1",
  organization_id: "org-1",
  finance_batch_id: "batch-1",
  batch_type: "streamer_payable",
  project_id: "project-1",
  counterparty_type: "streamer",
  counterparty_id: "streamer-1",
  counterparty_name_snapshot: "Streamer One",
  source_type: "live_report",
  source_id: "report-1",
  source_snapshot: { liveReportId: "report-1" },
  system_amount: "120.00",
  adjustment_amount: "0.00",
  final_amount: "120.00",
  evidence_level: "green",
  evidence_snapshot: { evidenceLevel: "green" },
  status: "active",
  exception_flags: ["late_review"],
  created_at: "2026-07-16T12:00:00.000Z",
  updated_at: "2026-07-16T12:00:00.000Z",
} satisfies FinanceBatchItemRow;

const adjustmentRow = {
  id: "adjustment-1",
  organization_id: "org-1",
  finance_batch_id: "batch-1",
  finance_batch_item_id: null,
  direction: "increase",
  amount: "25.35",
  reason: "Finance reviewed a late bonus.",
  evidence_snapshot: { noteId: "note-1" },
  created_by: "user-owner",
  created_at: "2026-07-16T12:05:00.000Z",
  voided_at: null,
} satisfies FinanceBatchAdjustmentRow;

function createRpcClient(result: unknown) {
  return {
    rpc: vi.fn(async () => ({ data: result, error: null })),
  };
}

describe("finance batch repository mappers", () => {
  it("maps finance batch rows to records", () => {
    expect(toFinanceBatchRecord(batchRow)).toEqual({
      id: "batch-1",
      organizationId: "org-1",
      batchType: "streamer_payable",
      title: "July streamer payable",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      status: "draft",
      hasExceptions: false,
      systemAmount: 210,
      adjustmentAmount: 0,
      finalAmount: 210,
      itemCount: 2,
      exceptionCount: 0,
      createdBy: "user-owner",
      statusReason: null,
      metadata: { source: "test" },
      createdAt: "2026-07-16T12:00:00.000Z",
      updatedAt: "2026-07-16T12:00:00.000Z",
    });
  });

  it("maps finance batch item and adjustment rows to records", () => {
    expect(toFinanceBatchItemRecord(itemRow)).toMatchObject({
      id: "item-1",
      organizationId: "org-1",
      financeBatchId: "batch-1",
      projectId: "project-1",
      counterpartyId: "streamer-1",
      sourceId: "report-1",
      systemAmount: 120,
      exceptionFlags: ["late_review"],
    });
    expect(toFinanceBatchAdjustmentRecord(adjustmentRow)).toMatchObject({
      id: "adjustment-1",
      financeBatchId: "batch-1",
      direction: "increase",
      amount: 25.35,
      reason: "Finance reviewed a late bonus.",
      voidedAt: null,
    });
  });
});

describe("SupabaseFinanceBatchRepository RPC writes", () => {
  it("passes item-level data to create_finance_batch and maps the returned rows", async () => {
    const client = createRpcClient({
      batch: batchRow,
      items: [itemRow],
    });
    const repo = new SupabaseFinanceBatchRepository(client as never);

    const result = await repo.createFinanceBatchAtomic({
      organizationId: "org-1",
      batchType: "streamer_payable",
      title: "July streamer payable",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      systemAmount: 120,
      adjustmentAmount: 0,
      finalAmount: 120,
      createdBy: "user-owner",
      items: [
        {
          projectId: "project-1",
          counterpartyType: "streamer",
          counterpartyId: "streamer-1",
          counterpartyNameSnapshot: "Streamer One",
          sourceType: "live_report",
          sourceId: "report-1",
          sourceSnapshot: { liveReportId: "report-1" },
          systemAmount: 120,
          adjustmentAmount: 0,
          finalAmount: 120,
          evidenceLevel: "green",
          evidenceSnapshot: { evidenceLevel: "green" },
          exceptionFlags: [],
        },
      ],
    });

    expect(client.rpc).toHaveBeenCalledWith("create_finance_batch", {
      p_organization_id: "org-1",
      p_batch_type: "streamer_payable",
      p_title: "July streamer payable",
      p_period_start: "2026-07-01",
      p_period_end: "2026-07-31",
      p_system_amount: 120,
      p_adjustment_amount: 0,
      p_final_amount: 120,
      p_created_by: "user-owner",
      p_items: [
        {
          project_id: "project-1",
          counterparty_type: "streamer",
          counterparty_id: "streamer-1",
          counterparty_name_snapshot: "Streamer One",
          source_type: "live_report",
          source_id: "report-1",
          source_snapshot: { liveReportId: "report-1" },
          system_amount: 120,
          adjustment_amount: 0,
          final_amount: 120,
          evidence_level: "green",
          evidence_snapshot: { evidenceLevel: "green" },
          exception_flags: [],
        },
      ],
    });
    expect(result.batch.systemAmount).toBe(210);
    expect(result.items[0]?.sourceId).toBe("report-1");
  });

  it("uses add_finance_batch_adjustment for adjustment writes", async () => {
    const client = createRpcClient({
      batch: { ...batchRow, adjustment_amount: "25.35", final_amount: "235.35" },
      adjustment: adjustmentRow,
    });
    const repo = new SupabaseFinanceBatchRepository(client as never);

    const result = await repo.addAdjustment({
      organizationId: "org-1",
      financeBatchId: "batch-1",
      financeBatchItemId: null,
      direction: "increase",
      amount: 25.35,
      reason: "Finance reviewed a late bonus.",
      evidenceSnapshot: { noteId: "note-1" },
      createdBy: "user-owner",
    });

    expect(client.rpc).toHaveBeenCalledWith("add_finance_batch_adjustment", {
      p_organization_id: "org-1",
      p_finance_batch_id: "batch-1",
      p_finance_batch_item_id: null,
      p_direction: "increase",
      p_amount: 25.35,
      p_reason: "Finance reviewed a late bonus.",
      p_evidence_snapshot: { noteId: "note-1" },
      p_created_by: "user-owner",
    });
    expect(result.adjustment.amount).toBe(25.35);
    expect(result.batch.finalAmount).toBe(235.35);
  });

  it("uses transition_finance_batch for status changes", async () => {
    const client = createRpcClient({
      batch: { ...batchRow, status: "pending_review" },
    });
    const repo = new SupabaseFinanceBatchRepository(client as never);

    const result = await repo.transitionBatch({
      organizationId: "org-1",
      financeBatchId: "batch-1",
      nextStatus: "pending_review",
      actorUserId: "user-owner",
      reason: null,
    });

    expect(client.rpc).toHaveBeenCalledWith("transition_finance_batch", {
      p_organization_id: "org-1",
      p_finance_batch_id: "batch-1",
      p_next_status: "pending_review",
      p_actor_user_id: "user-owner",
      p_reason: null,
    });
    expect(result.status).toBe("pending_review");
  });
});
