import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  generateSettlementBatch,
  addManualSettlementItem,
  listSettlementPool,
  lockSettlementBatch,
  reopenSettlementBatch,
  type SettlementBatchRecord,
  type SettlementRepository,
} from "./settlement-service";

const actor = {
  userId: "user-owner",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-1",
};

const opsActor = {
  ...actor,
  userId: "user-ops",
  role: "operator_business" as const,
};

const financeActor = {
  ...actor,
  userId: "user-finance",
  role: "finance" as const,
};

const report = {
  id: "report-1",
  organizationId: "org-1",
  projectId: "project-1",
  streamerId: "streamer-1",
  liveTaskId: "task-1",
  status: "approved" as const,
  settlementDuration: 120,
  timeSource: "system" as const,
  evidenceLevel: "green" as const,
  settledBatchItemId: null,
  createdAt: "2026-06-02T12:00:00.000Z",
};

const settlementRule = {
  projectId: "project-1",
  streamerId: "streamer-1",
  settlementMethod: "cpt" as const,
  hourlyRate: 80,
  baseSalary: 0,
};

function createBatch(
  patch: Partial<SettlementBatchRecord> = {},
): SettlementBatchRecord {
  return {
    id: "batch-1",
    organizationId: "org-1",
    projectId: "project-1",
    batchType: "payable",
    status: "generated",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    computedAmount: 160,
    manualAmount: 0,
    adjustmentAmount: 0,
    evidenceSummary: { green: 1, yellow: 0, red: 0, unknown: 0 },
    createdBy: "user-owner",
    lockedAt: null,
    reopenReason: null,
    lockReason: null,
    createdAt: "2026-06-02T12:10:00.000Z",
    updatedAt: "2026-06-02T12:10:00.000Z",
    ...patch,
  };
}

function createRepo(): SettlementRepository {
  return {
    listSettlementPoolReports: vi.fn(async () => [report]),
    getSettlementRules: vi.fn(async () => [settlementRule]),
    getProjectSettlementRule: vi.fn(async () => ({
      projectId: "project-1",
      settlementMethod: "cpt" as const,
      hourlyRate: 100,
      baseSalary: 0,
    })),
    createSettlementBatch: vi.fn(async (input) =>
      createBatch({
        id: "batch-created",
        projectId: input.projectId,
        batchType: input.batchType,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        computedAmount: input.computedAmount,
        manualAmount: input.manualAmount,
        adjustmentAmount: input.adjustmentAmount,
        evidenceSummary: input.evidenceSummary,
        createdBy: input.createdBy,
      }),
    ),
    createSettlementBatchItem: vi.fn(async (input) => ({
      id: "item-1",
      ...input,
      createdAt: "2026-06-02T12:11:00.000Z",
    })),
    markReportSettled: vi.fn(async () => undefined),
    getSettlementBatchById: vi.fn(async () => createBatch()),
    updateSettlementBatch: vi.fn(async (_batchId, patch) =>
      createBatch({
        ...patch,
        lockedAt: patch.lockedAt ?? null,
        reopenReason: patch.reopenReason ?? null,
      }),
    ),
  };
}

describe("settlement service", () => {
  let repo: SettlementRepository;
  const audit = vi.fn(async () => undefined);
  const notify = vi.fn(async () => undefined);

  beforeEach(() => {
    repo = createRepo();
    audit.mockClear();
    notify.mockClear();
  });

  it("lists only approved unsettled reports in the settlement pool", async () => {
    const reports = await listSettlementPool({
      repo,
      actor,
      projectId: "project-1",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });

    expect(reports).toEqual([report]);
    expect(repo.listSettlementPoolReports).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
      }),
    );
  });

  it("generates a payable batch from the pool and marks reports as settled", async () => {
    const result = await generateSettlementBatch({
      repo,
      audit,
      notify,
      actor,
      input: {
        projectId: "project-1",
        batchType: "payable",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      },
    });

    expect(result.batch).toMatchObject({
      computedAmount: 160,
      status: "generated",
    });
    expect(result.items).toHaveLength(1);
    expect(repo.createSettlementBatchItem).toHaveBeenCalledWith(
      expect.objectContaining({
        settlementBatchId: "batch-created",
        liveReportId: "report-1",
        computedAmount: 160,
        manualAmount: 0,
      }),
    );
    expect(repo.markReportSettled).toHaveBeenCalledWith({
      reportId: "report-1",
      settlementBatchItemId: "item-1",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create",
        module: "settlement",
        objectType: "settlement_batch",
      }),
    );
  });

  it("uses the project default rule for receivable batches", async () => {
    const result = await generateSettlementBatch({
      repo,
      audit,
      notify,
      actor,
      input: {
        projectId: "project-1",
        batchType: "receivable",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      },
    });

    expect(result.batch).toMatchObject({
      batchType: "receivable",
      computedAmount: 200,
    });
    expect(repo.getProjectSettlementRule).toHaveBeenCalledWith({
      projectId: "project-1",
    });
  });

  it("rejects batch generation when the pool has already been consumed", async () => {
    vi.mocked(repo.listSettlementPoolReports).mockResolvedValueOnce([]);

    await expect(
      generateSettlementBatch({
        repo,
        audit,
        notify,
        actor,
        input: {
          projectId: "project-1",
          batchType: "payable",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
        },
      }),
    ).rejects.toThrow("No unsettled approved reports found");
  });

  it("allows operator business to generate but blocks finance from mutating batches", async () => {
    await expect(
      generateSettlementBatch({
        repo,
        audit,
        notify,
        actor: opsActor,
        input: {
          projectId: "project-1",
          batchType: "payable",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
        },
      }),
    ).resolves.toBeDefined();

    await expect(
      generateSettlementBatch({
        repo,
        audit,
        notify,
        actor: financeActor,
        input: {
          projectId: "project-1",
          batchType: "payable",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
        },
      }),
    ).rejects.toThrow("Current role cannot manage settlement batches");
  });

  it("locks and reopens batches through high-risk audited transitions", async () => {
    await lockSettlementBatch({
      repo,
      audit,
      notify,
      actor,
      batchId: "batch-1",
      reason: "Finance checked",
      now: "2026-06-02T13:00:00.000Z",
    });

    expect(repo.updateSettlementBatch).toHaveBeenCalledWith(
      "batch-1",
      expect.objectContaining({
        status: "locked",
        lockedAt: "2026-06-02T13:00:00.000Z",
        lockReason: "Finance checked",
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lock",
        isHighRisk: true,
        reason: "Finance checked",
      }),
    );

    await expect(
      reopenSettlementBatch({
        repo,
        audit,
        notify,
        actor: opsActor,
        batchId: "batch-1",
        reason: "Need correction",
      }),
    ).rejects.toThrow("Only owners can reopen locked settlement batches");

    vi.mocked(repo.getSettlementBatchById).mockResolvedValueOnce(
      createBatch({ status: "locked", lockedAt: "2026-06-02T13:00:00.000Z" }),
    );
    await reopenSettlementBatch({
      repo,
      audit,
      notify,
      actor,
      batchId: "batch-1",
      reason: "Need correction",
    });

    expect(repo.updateSettlementBatch).toHaveBeenLastCalledWith(
      "batch-1",
      expect.objectContaining({
        status: "reopened",
        reopenReason: "Need correction",
      }),
    );
  });

  it("adds CPA CPS or gift as manual carrying rows with audited amount changes", async () => {
    const item = await addManualSettlementItem({
      repo,
      audit,
      notify,
      actor: opsActor,
      batchId: "batch-1",
      input: {
        itemType: "cpa",
        projectId: "project-1",
        streamerId: "streamer-1",
        manualAmount: 300,
        evidenceLevel: "red",
        reason: "Imported CPA claim sheet",
      },
    });

    expect(item).toMatchObject({
      itemType: "cpa",
      manualAmount: 300,
      computedAmount: 0,
      evidenceLevel: "red",
    });
    expect(repo.updateSettlementBatch).toHaveBeenCalledWith(
      "batch-1",
      expect.objectContaining({ manualAmount: 300 }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        module: "settlement",
        isHighRisk: true,
        reason: "Imported CPA claim sheet",
      }),
    );
  });
});
