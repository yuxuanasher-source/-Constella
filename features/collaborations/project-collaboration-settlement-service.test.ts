import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmCollaborationSettlementBatch,
  disputeCollaborationSettlementBatch,
  generateCollaborationSettlementBatch,
  lockCollaborationSettlementBatch,
  reopenCollaborationSettlementBatch,
  voidCollaborationSettlementBatch,
  type CollaborationSettlementBatchRecord,
  type CollaborationSettlementRepository,
  type CollaborationSettlementRevenueRecord,
} from "./project-collaboration-settlement-service";

const ownerActor = {
  userId: "user-owner",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-owner",
};

const partnerActor = {
  userId: "user-partner",
  name: "Partner",
  role: "ops_manager" as const,
  organizationId: "org-partner",
};

const financeActor = {
  userId: "user-finance",
  name: "Finance",
  role: "finance" as const,
  organizationId: "org-owner",
};

const agreement = {
  id: "agreement-1",
  projectId: "project-1",
  ownerOrganizationId: "org-owner",
  partnerOrganizationId: "org-partner",
  revenueShareBps: 900,
  status: "active" as const,
};

const confirmedRevenue: CollaborationSettlementRevenueRecord = {
  id: "revenue-1",
  agreementId: "agreement-1",
  projectId: "project-1",
  ownerOrganizationId: "org-owner",
  partnerOrganizationId: "org-partner",
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  revenueAmount: 100000,
  status: "confirmed",
};

function batch(
  patch: Partial<CollaborationSettlementBatchRecord> = {},
): CollaborationSettlementBatchRecord {
  return {
    id: "batch-1",
    agreementId: "agreement-1",
    projectId: "project-1",
    ownerOrganizationId: "org-owner",
    partnerOrganizationId: "org-partner",
    batchType: "partner_receivable",
    status: "generated",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    computedAmount: 9000,
    manualAmount: 0,
    adjustmentAmount: 0,
    evidenceSummary: { revenueRecordCount: 1 },
    createdBy: "user-owner",
    ...patch,
  };
}

function createRepo(): CollaborationSettlementRepository {
  return {
    getAgreementById: vi.fn(async () => agreement),
    listRevenueRecords: vi.fn(async () => [confirmedRevenue]),
    listConsumedRevenueRecordIds: vi.fn(async () => []),
    createSettlementBatch: vi.fn(async (input) =>
      batch({
        id: "batch-created",
        computedAmount: input.computedAmount,
        evidenceSummary: input.evidenceSummary,
        createdBy: input.createdBy,
      }),
    ),
    createSettlementItem: vi.fn(async (input) => ({
      id: "item-1",
      ...input,
    })),
    getSettlementBatchById: vi.fn(async () => batch()),
    updateSettlementBatch: vi.fn(async (_id, patch) => batch(patch)),
  };
}

describe("project collaboration settlement service", () => {
  let repo: CollaborationSettlementRepository;
  const audit = vi.fn(async () => undefined);

  beforeEach(() => {
    repo = createRepo();
    audit.mockClear();
  });

  it("generates partner receivable settlement from confirmed project revenue", async () => {
    const result = await generateCollaborationSettlementBatch({
      repo,
      audit,
      actor: ownerActor,
      input: {
        agreementId: "agreement-1",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      },
    });

    expect(result.batch.computedAmount).toBe(9000);
    expect(result.items).toHaveLength(1);
    expect(repo.createSettlementItem).toHaveBeenCalledWith(
      expect.objectContaining({
        agreementId: "agreement-1",
        revenueRecordId: "revenue-1",
        batchType: "partner_receivable",
        computedAmount: 9000,
      }),
    );
  });

  it("does not consume draft or void revenue records", async () => {
    vi.mocked(repo.listRevenueRecords).mockResolvedValueOnce([
      { ...confirmedRevenue, id: "draft", status: "draft" },
      { ...confirmedRevenue, id: "void", status: "voided" },
    ]);

    await expect(
      generateCollaborationSettlementBatch({
        repo,
        audit,
        actor: ownerActor,
        input: {
          agreementId: "agreement-1",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
        },
      }),
    ).rejects.toThrow("No confirmed collaboration revenue records found");
  });

  it("prevents duplicate settlement consumption", async () => {
    vi.mocked(repo.listConsumedRevenueRecordIds).mockResolvedValueOnce([
      "revenue-1",
    ]);

    await expect(
      generateCollaborationSettlementBatch({
        repo,
        audit,
        actor: ownerActor,
        input: {
          agreementId: "agreement-1",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
        },
      }),
    ).rejects.toThrow("No unconsumed collaboration revenue records found");
  });

  it("lets partner confirm or dispute only its own settlement", async () => {
    await confirmCollaborationSettlementBatch({
      repo,
      audit,
      actor: partnerActor,
      batchId: "batch-1",
    });
    expect(repo.updateSettlementBatch).toHaveBeenCalledWith(
      "batch-1",
      expect.objectContaining({ status: "partner_confirmed" }),
    );

    vi.mocked(repo.getSettlementBatchById).mockResolvedValueOnce(
      batch({ partnerOrganizationId: "org-other" }),
    );
    await expect(
      disputeCollaborationSettlementBatch({
        repo,
        audit,
        actor: partnerActor,
        batchId: "batch-1",
        reason: "Amount mismatch",
      }),
    ).rejects.toThrow("Only the partner organization can update this batch");
  });

  it("lets owner lock, reopen, or void according to role", async () => {
    await lockCollaborationSettlementBatch({
      repo,
      audit,
      actor: financeActor,
      batchId: "batch-1",
      reason: "Checked",
    });
    expect(repo.updateSettlementBatch).toHaveBeenCalledWith(
      "batch-1",
      expect.objectContaining({ status: "locked", lockReason: "Checked" }),
    );

    vi.mocked(repo.getSettlementBatchById).mockResolvedValueOnce(
      batch({ status: "locked" }),
    );
    await reopenCollaborationSettlementBatch({
      repo,
      audit,
      actor: ownerActor,
      batchId: "batch-1",
      reason: "Recheck",
    });
    expect(repo.updateSettlementBatch).toHaveBeenLastCalledWith(
      "batch-1",
      expect.objectContaining({ status: "reopened", reopenReason: "Recheck" }),
    );

    await expect(
      voidCollaborationSettlementBatch({
        repo,
        audit,
        actor: partnerActor,
        batchId: "batch-1",
        reason: "Nope",
      }),
    ).rejects.toThrow(
      "Only the owner organization can void settlement batches",
    );
  });

  it("cannot confirm or dispute a locked batch", async () => {
    vi.mocked(repo.getSettlementBatchById).mockResolvedValue(
      batch({ status: "locked" }),
    );

    await expect(
      confirmCollaborationSettlementBatch({
        repo,
        audit,
        actor: partnerActor,
        batchId: "batch-1",
      }),
    ).rejects.toThrow(/locked/);

    await expect(
      disputeCollaborationSettlementBatch({
        repo,
        audit,
        actor: partnerActor,
        batchId: "batch-1",
        reason: "Amount mismatch",
      }),
    ).rejects.toThrow(/locked/);
    expect(repo.updateSettlementBatch).not.toHaveBeenCalled();
  });

  it("cannot void a locked batch", async () => {
    vi.mocked(repo.getSettlementBatchById).mockResolvedValueOnce(
      batch({ status: "locked" }),
    );

    await expect(
      voidCollaborationSettlementBatch({
        repo,
        audit,
        actor: ownerActor,
        batchId: "batch-1",
        reason: "Cancel",
      }),
    ).rejects.toThrow(/locked/);
    expect(repo.updateSettlementBatch).not.toHaveBeenCalled();
  });

  it("cannot reopen anything except a locked batch", async () => {
    vi.mocked(repo.getSettlementBatchById).mockResolvedValueOnce(
      batch({ status: "generated" }),
    );

    await expect(
      reopenCollaborationSettlementBatch({
        repo,
        audit,
        actor: ownerActor,
        batchId: "batch-1",
        reason: "Recheck",
      }),
    ).rejects.toThrow(/locked/);
    expect(repo.updateSettlementBatch).not.toHaveBeenCalled();
  });
});
