import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmSettlementBatch,
  generateSettlementBatch,
  addManualSettlementItem,
  listSettlementPool,
  lockSettlementBatch,
  reopenSettlementBatch,
  type SettlementBatchAtomicItemInput,
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
  cpsRateBps: 1500,
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
    createSettlementBatchAtomic: vi.fn(async (input) => ({
      batch: createBatch({
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
      items: input.items.map((item: SettlementBatchAtomicItemInput, index: number) => ({
        id: `item-${index + 1}`,
        organizationId: input.organizationId,
        settlementBatchId: "batch-created",
        projectId: input.projectId,
        ...item,
        createdAt: "2026-06-02T12:11:00.000Z",
      })),
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

  it("filters cross-organization reports returned by the repository", async () => {
    vi.mocked(repo.listSettlementPoolReports).mockResolvedValueOnce([
      {
        ...report,
        id: "report-cross-org",
        organizationId: "org-2",
      },
    ]);

    await expect(
      listSettlementPool({
        repo,
        actor,
        projectId: "project-1",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      }),
    ).resolves.toEqual([]);
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
    expect(repo.createSettlementBatchAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        batchType: "payable",
        computedAmount: 160,
        items: [
          expect.objectContaining({
            liveReportId: "report-1",
            itemType: "live_report_payable",
            computedAmount: 160,
            manualAmount: 0,
          }),
        ],
      }),
    );
    // The legacy non-atomic persistence path is no longer used.
    expect(repo.createSettlementBatchItem).not.toHaveBeenCalled();
    expect(repo.markReportSettled).not.toHaveBeenCalled();
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
    expect(repo.createSettlementBatchAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        batchType: "receivable",
        items: [
          expect.objectContaining({ itemType: "live_report_receivable" }),
        ],
      }),
    );
  });

  it("bills receivable base salary once across multiple streamers", async () => {
    vi.mocked(repo.listSettlementPoolReports).mockResolvedValueOnce([
      { ...report, id: "report-a", streamerId: "streamer-1" },
      { ...report, id: "report-b", streamerId: "streamer-2" },
    ]);
    vi.mocked(repo.getProjectSettlementRule).mockResolvedValueOnce({
      projectId: "project-1",
      settlementMethod: "base_salary_cpt",
      hourlyRate: 60,
      baseSalary: 500,
    });

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

    // 2 × CPT ((120 / 60) × 60 = 120) + the project base salary once (500) = 740,
    // not 1240 (which would double-count the base salary per streamer).
    expect(result.batch.computedAmount).toBe(740);
  });

  it("keeps receivable and payable settlement eligibility separate", async () => {
    vi.mocked(repo.listSettlementPoolReports).mockResolvedValueOnce([
      {
        ...report,
        settledBatchItemId: "payable-item-1",
        settledBatchTypes: ["payable"],
      },
    ]);

    await expect(
      generateSettlementBatch({
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
      }),
    ).resolves.toMatchObject({
      batch: expect.objectContaining({ batchType: "receivable" }),
      items: [expect.objectContaining({ itemType: "live_report_receivable" })],
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

  it("does not generate batches from cross-organization reports returned by the repository", async () => {
    vi.mocked(repo.listSettlementPoolReports).mockResolvedValueOnce([
      {
        ...report,
        id: "report-cross-org",
        organizationId: "org-2",
      },
    ]);

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

    expect(repo.createSettlementBatchAtomic).not.toHaveBeenCalled();
    expect(repo.createSettlementBatchItem).not.toHaveBeenCalled();
  });

  it("passes the target batch type when loading settlement pool reports", async () => {
    await generateSettlementBatch({
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

    expect(repo.listSettlementPoolReports).toHaveBeenCalledWith(
      expect.objectContaining({
        batchType: "receivable",
      }),
    );
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

  it("lets finance confirm generated batches through high-risk audited transitions", async () => {
    const batch = await confirmSettlementBatch({
      repo,
      audit,
      notify,
      actor: financeActor,
      batchId: "batch-1",
      reason: "Finance verified the amounts",
    });

    expect(batch.status).toBe("confirmed");
    expect(repo.updateSettlementBatch).toHaveBeenCalledWith(
      "batch-1",
      expect.objectContaining({ status: "confirmed" }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "approve",
        module: "settlement",
        objectType: "settlement_batch",
        objectId: "batch-1",
        changedFields: ["status"],
        isHighRisk: true,
        reason: "Finance verified the amounts",
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Settlement batch confirmed",
        objectId: "batch-1",
        isHighRisk: true,
      }),
    );
  });

  it("lets owners confirm reopened batches", async () => {
    vi.mocked(repo.getSettlementBatchById).mockResolvedValueOnce(
      createBatch({ status: "reopened", reopenReason: "Need correction" }),
    );

    await confirmSettlementBatch({
      repo,
      audit,
      notify,
      actor,
      batchId: "batch-1",
      reason: "Recheck complete",
    });

    expect(repo.updateSettlementBatch).toHaveBeenCalledWith(
      "batch-1",
      expect.objectContaining({ status: "confirmed" }),
    );
  });

  it("blocks non-finance non-owner roles from confirming batches", async () => {
    const roles = ["ops_manager", "operator_business", "streamer"] as const;
    for (const role of roles) {
      await expect(
        confirmSettlementBatch({
          repo,
          audit,
          notify,
          actor: { ...actor, userId: `user-${role}`, role },
          batchId: "batch-1",
          reason: "Should be rejected",
        }),
      ).rejects.toThrow("Current role cannot confirm settlement batches");
    }

    expect(repo.updateSettlementBatch).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("requires a reason to confirm a settlement batch", async () => {
    await expect(
      confirmSettlementBatch({
        repo,
        audit,
        notify,
        actor: financeActor,
        batchId: "batch-1",
        reason: "  ",
      }),
    ).rejects.toThrow("Confirming a settlement batch requires a reason");

    expect(repo.updateSettlementBatch).not.toHaveBeenCalled();
  });

  it("rejects confirming batches that are not generated or reopened", async () => {
    const statuses = ["locked", "voided"] as const;
    for (const status of statuses) {
      vi.mocked(repo.getSettlementBatchById).mockResolvedValueOnce(
        createBatch({ status }),
      );

      await expect(
        confirmSettlementBatch({
          repo,
          audit,
          notify,
          actor: financeActor,
          batchId: "batch-1",
          reason: "Attempted confirm",
        }),
      ).rejects.toThrow(
        "Only generated or reopened settlement batches can be confirmed",
      );
    }

    expect(repo.updateSettlementBatch).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
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

  it("calculates CPS manual rows from sales amount and frozen rate", async () => {
    const item = await addManualSettlementItem({
      repo,
      audit,
      notify,
      actor: opsActor,
      batchId: "batch-1",
      input: {
        itemType: "cps",
        projectId: "project-1",
        streamerId: "streamer-1",
        salesAmount: 12000,
        evidenceLevel: "yellow",
        reason: "Imported CPS sales sheet",
      },
    });

    expect(item).toMatchObject({
      itemType: "cps",
      manualAmount: 1800,
      computedAmount: 0,
      evidenceSnapshot: expect.objectContaining({
        source: "manual_cps_import",
        salesAmount: 12000,
        cpsRateBps: 1500,
        settlementRuleSource: "project_streamer_snapshot",
      }),
    });
  });
});
