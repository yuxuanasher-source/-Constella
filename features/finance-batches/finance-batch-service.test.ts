import { describe, expect, it, vi } from "vitest";

import type {
  FinanceActor,
  FinanceBatchAdjustmentRecord,
  FinanceBatchItemRecord,
  FinanceBatchRecord,
} from "./finance-batch-types";
import {
  addFinanceBatchAdjustment,
  createFinanceBatch,
  transitionFinanceBatch,
  type FinanceBatchAtomicItemInput,
  type FinanceBatchRepository,
  type StreamerPayableSource,
} from "./finance-batch-service";

const actor: FinanceActor = {
  userId: "user-owner",
  name: "Owner",
  role: "owner",
  organizationId: "org-1",
};

const sourceA: StreamerPayableSource = {
  id: "report-1",
  organizationId: "org-1",
  projectId: "project-1",
  projectName: "Project One",
  projectCode: "P001",
  streamerId: "streamer-1",
  streamerName: "Streamer One",
  settlementDuration: 90,
  evidenceLevel: "green",
  createdAt: "2026-07-05T12:00:00.000Z",
  hourlyRate: 80,
};

const sourceB: StreamerPayableSource = {
  ...sourceA,
  id: "report-2",
  projectId: "project-2",
  projectName: "Project Two",
  projectCode: "P002",
  streamerId: "streamer-2",
  streamerName: "Streamer Two",
  settlementDuration: 45,
  evidenceLevel: "yellow",
  hourlyRate: 120,
};

function makeBatch(
  patch: Partial<FinanceBatchRecord> = {},
): FinanceBatchRecord {
  return {
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
    metadata: {},
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:00:00.000Z",
    ...patch,
  };
}

function makeAdjustment(
  patch: Partial<FinanceBatchAdjustmentRecord> = {},
): FinanceBatchAdjustmentRecord {
  return {
    id: "adjustment-1",
    organizationId: "org-1",
    financeBatchId: "batch-1",
    financeBatchItemId: null,
    direction: "increase",
    amount: 25.35,
    reason: "Finance reviewed a late bonus.",
    evidenceSnapshot: {},
    createdBy: "user-owner",
    createdAt: "2026-07-16T12:05:00.000Z",
    voidedAt: null,
    ...patch,
  };
}

function makeRepo(): FinanceBatchRepository {
  return {
    listStreamerPayableSources: vi.fn(async () => [sourceA, sourceB]),
    createFinanceBatchAtomic: vi.fn(async (input) => ({
      batch: makeBatch({
        title: input.title ?? null,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        systemAmount: 210,
        finalAmount: 210,
      }),
      items: input.items.map(
        (
          item: FinanceBatchAtomicItemInput,
          index: number,
        ): FinanceBatchItemRecord => ({
          id: `item-${index + 1}`,
          organizationId: input.organizationId,
          financeBatchId: "batch-1",
          batchType: input.batchType,
          projectId: item.projectId,
          counterpartyType: item.counterpartyType,
          counterpartyId: item.counterpartyId,
          counterpartyNameSnapshot: item.counterpartyNameSnapshot,
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          sourceSnapshot: item.sourceSnapshot,
          systemAmount: item.systemAmount,
          adjustmentAmount: item.adjustmentAmount,
          finalAmount: item.finalAmount,
          evidenceLevel: item.evidenceLevel,
          evidenceSnapshot: item.evidenceSnapshot,
          status: "active",
          exceptionFlags: item.exceptionFlags,
          createdAt: "2026-07-16T12:00:00.000Z",
          updatedAt: "2026-07-16T12:00:00.000Z",
        }),
      ),
    })),
    getFinanceBatch: vi.fn(async () => makeBatch()),
    addAdjustment: vi.fn(async () => ({
      batch: makeBatch({
        adjustmentAmount: 25.35,
        finalAmount: 235.35,
      }),
      adjustment: makeAdjustment(),
    })),
    transitionBatch: vi.fn(async (input) =>
      makeBatch({
        status: input.nextStatus,
        statusReason: input.reason ?? null,
      }),
    ),
  };
}

describe("finance batch service", () => {
  it("creates a cross-project streamer payable batch from approved sources", async () => {
    const repo = makeRepo();

    const result = await createFinanceBatch({
      repo,
      actor,
      input: {
        batchType: "streamer_payable",
        title: "July streamer payable",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        selection: {
          projectIds: ["project-1", "project-2", "project-1", ""],
          streamerIds: ["streamer-1", "streamer-2", "streamer-1"],
          sourceIds: ["report-1", "report-2", "report-1"],
        },
      },
    });

    expect(repo.listStreamerPayableSources).toHaveBeenCalledWith({
      organizationId: "org-1",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      projectIds: ["project-1", "project-2"],
      streamerIds: ["streamer-1", "streamer-2"],
      sourceIds: ["report-1", "report-2"],
    });
    expect(repo.createFinanceBatchAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        batchType: "streamer_payable",
        title: "July streamer payable",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        createdBy: "user-owner",
        items: [
          expect.objectContaining({
            projectId: "project-1",
            counterpartyType: "streamer",
            counterpartyId: "streamer-1",
            counterpartyNameSnapshot: "Streamer One",
            sourceType: "live_report",
            sourceId: "report-1",
            systemAmount: 120,
            adjustmentAmount: 0,
            finalAmount: 120,
            evidenceLevel: "green",
            sourceSnapshot: expect.objectContaining({
              liveReportId: "report-1",
              projectId: "project-1",
              projectName: "Project One",
              hourlyRate: 80,
              settlementDuration: 90,
            }),
            evidenceSnapshot: expect.objectContaining({
              evidenceLevel: "green",
              sourceType: "live_report",
            }),
          }),
          expect.objectContaining({
            projectId: "project-2",
            counterpartyId: "streamer-2",
            systemAmount: 90,
            finalAmount: 90,
            evidenceLevel: "yellow",
          }),
        ],
      }),
    );
    expect(result.batch.systemAmount).toBe(210);
    expect(result.items).toHaveLength(2);
  });

  it("rejects finance batch types that are not enabled yet", async () => {
    const repo = makeRepo();

    await expect(
      createFinanceBatch({
        repo,
        actor,
        input: {
          batchType: "receivable",
          periodStart: "2026-07-01",
          periodEnd: "2026-07-31",
          selection: {},
        },
      }),
    ).rejects.toThrow("receivable finance batches are not enabled yet");
    expect(repo.listStreamerPayableSources).not.toHaveBeenCalled();
  });

  it("adds an adjustment without changing the batch system amount", async () => {
    const repo = makeRepo();

    const result = await addFinanceBatchAdjustment({
      repo,
      actor,
      input: {
        financeBatchId: "batch-1",
        direction: "increase",
        amount: 25.345,
        reason: "Finance reviewed a late bonus.",
        evidenceSnapshot: { noteId: "note-1" },
      },
    });

    expect(repo.getFinanceBatch).toHaveBeenCalledWith({
      organizationId: "org-1",
      financeBatchId: "batch-1",
    });
    expect(repo.addAdjustment).toHaveBeenCalledWith({
      organizationId: "org-1",
      financeBatchId: "batch-1",
      financeBatchItemId: null,
      direction: "increase",
      amount: 25.35,
      reason: "Finance reviewed a late bonus.",
      evidenceSnapshot: { noteId: "note-1" },
      createdBy: "user-owner",
    });
    expect(result.batch.systemAmount).toBe(210);
    expect(result.batch.adjustmentAmount).toBe(25.35);
  });

  it("submits a draft batch for review", async () => {
    const repo = makeRepo();

    const result = await transitionFinanceBatch({
      repo,
      actor,
      input: {
        financeBatchId: "batch-1",
        action: "submit",
      },
    });

    expect(repo.transitionBatch).toHaveBeenCalledWith({
      organizationId: "org-1",
      financeBatchId: "batch-1",
      nextStatus: "pending_review",
      actorUserId: "user-owner",
      reason: null,
    });
    expect(result.status).toBe("pending_review");
  });

  it("requires a reason for void and reopen transitions", async () => {
    const repo = makeRepo();

    await expect(
      transitionFinanceBatch({
        repo,
        actor,
        input: {
          financeBatchId: "batch-1",
          action: "void",
          reason: "   ",
        },
      }),
    ).rejects.toThrow("Finance batch transition reason is required");

    vi.mocked(repo.getFinanceBatch).mockResolvedValueOnce(
      makeBatch({ status: "locked" }),
    );
    await expect(
      transitionFinanceBatch({
        repo,
        actor,
        input: {
          financeBatchId: "batch-1",
          action: "reopen",
        },
      }),
    ).rejects.toThrow("Finance batch transition reason is required");

    expect(repo.transitionBatch).not.toHaveBeenCalled();
  });
});
