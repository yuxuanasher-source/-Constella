import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmSettlementBatch,
  generateSettlementBatch,
  addManualSettlementItem,
  listSettlementPool,
  lockSettlementBatch,
  reopenSettlementBatch,
  sendSettlementBatchStatements,
  type SettlementBatchAtomicItemInput,
  type SettlementBatchRecord,
  type CustomSettlementExecutionPort,
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
      links: [],
      exceptions: [],
    })),
    resolveSettlementRuleException: vi.fn(async () => ({
      batch: createBatch(),
      item: {
        id: "item-1",
        organizationId: "org-1",
        settlementBatchId: "batch-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        liveReportId: "report-1",
        itemType: "live_report_payable",
        computedAmount: 0.01,
        manualAmount: 0,
        adjustmentAmount: 0,
        evidenceSnapshot: {},
      },
      exception: {
        id: "exception-1",
        organizationId: "org-1",
        projectId: "project-1",
        settlementBatchId: "batch-1",
        settlementBatchItemId: "item-1",
        liveReportId: "report-1",
        ruleVersionId: null,
        layerSnapshot: {},
        variableName: "salesAmountCents",
        policy: "route_item_to_review" as const,
        status: "resolved" as const,
        resolutionValue: { moneyCents: 1 },
        resolutionReason: "Finance checked",
        createdBy: "user-owner",
        resolvedBy: "user-finance",
        createdAt: "2026-06-02T12:11:00.000Z",
        resolvedAt: "2026-06-02T12:12:00.000Z",
      },
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
    listSettlementBatchItems: vi.fn(async () => []),
    listStreamerUserLinks: vi.fn(async () => []),
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
            liveReportIds: ["report-1"],
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

  it("uses the legacy calculation branch when no custom layers are active", async () => {
    const customExecutionPort: CustomSettlementExecutionPort = {
      resolveAndExecute: vi.fn(
        async (): Promise<"no_custom_layers"> => "no_custom_layers",
      ),
    };

    await generateSettlementBatch({
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
      customExecutionPort,
    });

    expect(customExecutionPort.resolveAndExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        batchType: "payable",
        reports: [report],
      }),
    );
    expect(repo.getSettlementRules).toHaveBeenCalled();
    expect(repo.createSettlementBatchAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        computedAmount: 160,
        items: [
          expect.objectContaining({
            computedAmount: 160,
            evidenceSnapshot: expect.not.objectContaining({
              ruleEngine: expect.anything(),
            }),
          }),
        ],
      }),
    );
  });

  it("persists custom cents snapshots and sums batch totals as integer cents", async () => {
    const customExecutionPort: CustomSettlementExecutionPort = {
      resolveAndExecute: vi.fn(async () => ({
        items: [
          customProductionItem({
            sourceReportIds: ["report-1"],
            computedAmountCents: 10,
          }),
          customProductionItem({
            streamerId: "streamer-2",
            sourceReportIds: ["report-2"],
            computedAmountCents: 20,
          }),
        ],
      })),
    };
    vi.mocked(repo.listSettlementPoolReports).mockResolvedValueOnce([
      report,
      { ...report, id: "report-2", streamerId: "streamer-2" },
    ]);

    await generateSettlementBatch({
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
      customExecutionPort,
    });

    expect(repo.getSettlementRules).toHaveBeenCalled();
    expect(repo.createSettlementBatchAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        computedAmount: 0.3,
        items: [
          expect.objectContaining({
            computedAmount: 0.1,
            liveReportIds: ["report-1"],
            evidenceSnapshot: expect.objectContaining({
              ruleEngine: expect.objectContaining({
                namedOutputsCents: { final: 10 },
                sourceReportIds: ["report-1"],
              }),
            }),
          }),
          expect.objectContaining({
            computedAmount: 0.2,
            liveReportIds: ["report-2"],
            evidenceSnapshot: expect.objectContaining({
              ruleEngine: expect.objectContaining({
                namedOutputsCents: { final: 20 },
                sourceReportIds: ["report-2"],
              }),
            }),
          }),
        ],
      }),
    );
  });

  it("excludes review-routed custom placeholders from batch totals", async () => {
    const customExecutionPort: CustomSettlementExecutionPort = {
      resolveAndExecute: vi.fn(async () => ({
        items: [
          customProductionItem({
            sourceReportIds: ["report-1"],
            computedAmountCents: 10_000,
          }),
          customProductionItem({
            sourceReportIds: ["report-review"],
            computedAmountCents: 0,
            reviewRouted: true,
            exceptions: [
              {
                liveReportId: "report-review",
                ruleVersionId: "rule-version-1",
                layerSnapshot: { layer: "project_base" },
                variableName: "gift_amount",
                policy: "route_item_to_review",
                createdBy: "user-owner",
              },
            ],
          }),
        ],
      })),
    };
    vi.mocked(repo.listSettlementPoolReports).mockResolvedValueOnce([
      report,
      { ...report, id: "report-review" },
    ]);

    await generateSettlementBatch({
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
      customExecutionPort,
    });

    expect(repo.createSettlementBatchAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        computedAmount: 100,
        items: [
          expect.objectContaining({ computedAmount: 100 }),
          expect.objectContaining({
            computedAmount: 0,
            exceptions: [
              expect.objectContaining({
                variableName: "gift_amount",
                policy: "route_item_to_review",
              }),
            ],
          }),
        ],
      }),
    );
  });

  it("propagates custom execution errors without falling back to fixed rules", async () => {
    const customExecutionPort: CustomSettlementExecutionPort = {
      resolveAndExecute: vi.fn(async () => {
        throw new Error("CUSTOM_RULE_EXECUTION_BLOCKED");
      }),
    };

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
        customExecutionPort,
      }),
    ).rejects.toThrow("CUSTOM_RULE_EXECUTION_BLOCKED");

    expect(repo.createSettlementBatchAtomic).not.toHaveBeenCalled();
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

  it("checks the rule exception gate before confirming a batch", async () => {
    const gate = {
      assertNoOpenRuleExceptions: vi.fn(async () => {
        throw new Error("Settlement batch has unresolved rule exceptions");
      }),
    };

    await expect(
      confirmSettlementBatch({
        repo,
        audit,
        notify,
        actor: financeActor,
        batchId: "batch-1",
        reason: "Finance verified the amounts",
        gate,
      }),
    ).rejects.toThrow("Settlement batch has unresolved rule exceptions");

    expect(gate.assertNoOpenRuleExceptions).toHaveBeenCalledWith("batch-1");
    expect(repo.updateSettlementBatch).not.toHaveBeenCalled();
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

  it("checks the rule exception gate before locking a batch", async () => {
    const gate = {
      assertNoOpenRuleExceptions: vi.fn(async () => {
        throw new Error("Settlement batch has unresolved rule exceptions");
      }),
    };

    await expect(
      lockSettlementBatch({
        repo,
        audit,
        notify,
        actor,
        batchId: "batch-1",
        reason: "Finance checked",
        gate,
      }),
    ).rejects.toThrow("Settlement batch has unresolved rule exceptions");

    expect(gate.assertNoOpenRuleExceptions).toHaveBeenCalledWith("batch-1");
    expect(repo.updateSettlementBatch).not.toHaveBeenCalled();
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

  it("generates a batch only for the selected streamers and passes the title", async () => {
    vi.mocked(repo.listSettlementPoolReports).mockResolvedValueOnce([
      report,
      { ...report, id: "report-2", streamerId: "streamer-2" },
    ]);

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
        title: " 六月主播应付 · 第一批 ",
        streamerIds: ["streamer-1"],
      },
    });

    expect(repo.createSettlementBatchAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "六月主播应付 · 第一批",
        items: [
          expect.objectContaining({
            streamerId: "streamer-1",
            liveReportId: "report-1",
            liveReportIds: ["report-1"],
          }),
        ],
      }),
    );
    expect(result.items).toHaveLength(1);
  });

  it("rejects batch generation when no pool reports match the selected streamers", async () => {
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
          streamerIds: ["streamer-none"],
        },
      }),
    ).rejects.toThrow(
      "No unsettled approved reports found for the selected streamers",
    );
  });

  it("rejects batch generation with an explicit empty streamer selection", async () => {
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
          streamerIds: [],
        },
      }),
    ).rejects.toThrow("At least one streamer must be selected");
  });

  it("sends per-streamer statements for confirmed payable batches", async () => {
    vi.mocked(repo.getSettlementBatchById).mockResolvedValue(
      createBatch({ status: "locked", title: "六月主播应付" }),
    );
    vi.mocked(repo.listSettlementBatchItems).mockResolvedValue([
      {
        id: "item-1",
        organizationId: "org-1",
        settlementBatchId: "batch-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        liveReportId: "report-1",
        itemType: "live_report_payable",
        computedAmount: 160,
        manualAmount: 20,
        adjustmentAmount: -10,
        evidenceLevel: "green",
        evidenceSnapshot: {},
      },
      {
        id: "item-2",
        organizationId: "org-1",
        settlementBatchId: "batch-1",
        projectId: "project-1",
        streamerId: "streamer-2",
        liveReportId: "report-2",
        itemType: "live_report_payable",
        computedAmount: 80,
        manualAmount: 0,
        adjustmentAmount: 0,
        evidenceLevel: "green",
        evidenceSnapshot: {},
      },
    ]);
    vi.mocked(repo.listStreamerUserLinks).mockResolvedValue([
      { streamerId: "streamer-1", userId: "user-s1", displayName: "主播一" },
      { streamerId: "streamer-2", userId: null, displayName: "主播二" },
    ]);

    const result = await sendSettlementBatchStatements({
      repo,
      audit,
      notify,
      actor: opsActor,
      batchId: "batch-1",
    });

    expect(result).toEqual({ notified: 1, skipped: 1 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: "user-s1",
        type: "settlement",
        objectId: "batch-1",
        source: "settlement.batch.statement",
        content: expect.stringContaining("¥170.00"),
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "export",
        module: "settlement",
        objectId: "batch-1",
      }),
    );
  });

  it("rejects sending statements for unfinalized or receivable batches", async () => {
    vi.mocked(repo.getSettlementBatchById).mockResolvedValueOnce(
      createBatch({ status: "generated" }),
    );
    await expect(
      sendSettlementBatchStatements({
        repo,
        audit,
        notify,
        actor,
        batchId: "batch-1",
      }),
    ).rejects.toThrow(
      "Only confirmed or locked settlement batches can be sent to streamers",
    );

    vi.mocked(repo.getSettlementBatchById).mockResolvedValueOnce(
      createBatch({ status: "locked", batchType: "receivable" }),
    );
    await expect(
      sendSettlementBatchStatements({
        repo,
        audit,
        notify,
        actor,
        batchId: "batch-1",
      }),
    ).rejects.toThrow("Only payable batches can be sent to streamers");
  });
});

function customProductionItem(input: {
  streamerId?: string;
  sourceReportIds: string[];
  computedAmountCents: number;
  reviewRouted?: boolean;
  exceptions?: SettlementBatchAtomicItemInput["exceptions"];
}) {
  return {
    streamerId: input.streamerId ?? "streamer-1",
    sourceReportIds: input.sourceReportIds,
    computedAmountCents: input.computedAmountCents,
    reviewRouted: input.reviewRouted ?? false,
    evidenceLevel: "green" as const,
    evidenceSnapshot: {
      ruleEngine: {
        mode: "custom",
        contractHash: "contract-hash",
        grain: "report",
        parameters: {},
        appliedLayers: [],
        membershipAssignmentIds: [],
        membershipSnapshotHash: "membership-hash",
        typedInputs: {},
        namedOutputsCents: { final: input.computedAmountCents },
        missingDataDecisions: [],
        sourceReportIds: input.sourceReportIds,
        explanationZh: "自定义结算规则计算完成。",
      },
    },
    exceptions: input.exceptions,
  };
}
