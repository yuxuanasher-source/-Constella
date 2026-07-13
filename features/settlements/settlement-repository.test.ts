import { describe, expect, it, vi } from "vitest";

import { SupabaseSettlementRepository } from "./settlement-repository";

const batchRow = {
  id: "batch-1",
  organization_id: "org-1",
  project_id: "project-1",
  batch_type: "payable",
  status: "generated",
  title: "July payable",
  period_start: "2026-07-01",
  period_end: "2026-07-31",
  computed_amount: 18.01,
  manual_amount: 0,
  adjustment_amount: 0,
  evidence_summary: { green: 2 },
  lock_reason: null,
  reopen_reason: null,
  created_by: "user-owner",
  locked_at: null,
  created_at: "2026-07-12T00:00:00.000Z",
  updated_at: "2026-07-12T00:00:00.000Z",
};

const itemRow = {
  id: "item-1",
  organization_id: "org-1",
  settlement_batch_id: "batch-1",
  project_id: "project-1",
  streamer_id: "streamer-1",
  live_report_id: null,
  item_type: "live_report_payable",
  computed_amount: 18.01,
  manual_amount: 0,
  adjustment_amount: 0,
  evidence_level: "yellow",
  evidence_snapshot: { ruleEngine: { sourceReportIds: ["report-1", "report-2"] } },
  created_at: "2026-07-12T00:00:00.000Z",
};

function createQuery(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    lte: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(() => query),
    returns: vi.fn(async () => ({ data, error })),
  };
  return query;
}

describe("SupabaseSettlementRepository", () => {
  it("maps atomic batch items to aggregate report links and exception payloads", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        batch: batchRow,
        items: [itemRow],
        links: [
          {
            settlement_batch_item_id: "item-1",
            live_report_id: "report-1",
          },
          {
            settlement_batch_item_id: "item-1",
            live_report_id: "report-2",
          },
        ],
        exceptions: [
          {
            id: "exception-1",
            organization_id: "org-1",
            project_id: "project-1",
            settlement_batch_id: "batch-1",
            settlement_batch_item_id: "item-1",
            live_report_id: "report-1",
            rule_version_id: "rule-version-1",
            layer_snapshot: { layer: "project" },
            variable_name: "salesAmountCents",
            policy: "route_item_to_review",
            status: "review_required",
            resolution_value: null,
            resolution_reason: null,
            created_by: "user-owner",
            resolved_by: null,
            created_at: "2026-07-12T00:00:00.000Z",
            resolved_at: null,
          },
        ],
      },
      error: null,
    }));
    const repo = new SupabaseSettlementRepository({ rpc } as never);

    const result = await repo.createSettlementBatchAtomic({
      organizationId: "org-1",
      projectId: "project-1",
      batchType: "payable",
      title: "July payable",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      computedAmount: 18.01,
      manualAmount: 0,
      adjustmentAmount: 0,
      evidenceSummary: { green: 2 },
      createdBy: "user-owner",
      items: [
        {
          streamerId: "streamer-1",
          liveReportIds: ["report-1", "report-2"],
          itemType: "live_report_payable",
          computedAmount: 18.01,
          manualAmount: 0,
          adjustmentAmount: 0,
          evidenceLevel: "yellow",
          evidenceSnapshot: {
            ruleEngine: { sourceReportIds: ["report-1", "report-2"] },
          },
          exceptions: [
            {
              liveReportId: "report-1",
              ruleVersionId: "rule-version-1",
              layerSnapshot: { layer: "project" },
              variableName: "salesAmountCents",
              policy: "route_item_to_review",
              createdBy: "user-owner",
            },
          ],
        },
      ],
    });

    expect(rpc).toHaveBeenCalledWith(
      "generate_settlement_batch",
      expect.objectContaining({
        p_items: [
          expect.objectContaining({
            live_report_id: null,
            live_report_ids: ["report-1", "report-2"],
            exceptions: [
              expect.objectContaining({
                live_report_id: "report-1",
                rule_version_id: "rule-version-1",
                variable_name: "salesAmountCents",
                policy: "route_item_to_review",
              }),
            ],
          }),
        ],
      }),
    );
    expect(result.links).toEqual([
      { settlementBatchItemId: "item-1", liveReportId: "report-1" },
      { settlementBatchItemId: "item-1", liveReportId: "report-2" },
    ]);
    expect(result.exceptions).toEqual([
      expect.objectContaining({
        id: "exception-1",
        settlementBatchItemId: "item-1",
        variableName: "salesAmountCents",
        status: "review_required",
      }),
    ]);
  });

  it("uses aggregate links with a legacy fallback when filtering settled pool reports", async () => {
    const reports = [
      {
        id: "report-linked",
        organization_id: "org-1",
        project_id: "project-1",
        streamer_id: "streamer-1",
        live_task_id: "task-1",
        status: "approved",
        settlement_duration: 60,
        time_source: "system",
        evidence_level: "green",
        settled_batch_item_id: null,
        created_at: "2026-07-12T00:00:00.000Z",
      },
      {
        id: "report-legacy",
        organization_id: "org-1",
        project_id: "project-1",
        streamer_id: "streamer-2",
        live_task_id: "task-2",
        status: "approved",
        settlement_duration: 60,
        time_source: "system",
        evidence_level: "green",
        settled_batch_item_id: "legacy-item",
        created_at: "2026-07-12T01:00:00.000Z",
      },
    ];
    const from = vi.fn((table: string) => {
      if (table === "live_reports") {
        return createQuery(reports);
      }
      if (table === "settlement_batch_item_reports") {
        return createQuery([
          {
            live_report_id: "report-linked",
            settlement_batch_items: {
              settlement_batches: { batch_type: "payable" },
            },
          },
        ]);
      }
      if (table === "settlement_batch_items") {
        return createQuery([
          {
            live_report_id: "report-legacy",
            settlement_batches: { batch_type: "payable" },
          },
        ]);
      }
      throw new Error(`unexpected table ${table}`);
    });
    const repo = new SupabaseSettlementRepository({ from } as never);

    await expect(
      repo.listSettlementPoolReports({
        organizationId: "org-1",
        projectId: "project-1",
        batchType: "payable",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      }),
    ).resolves.toEqual([]);
    expect(from).toHaveBeenCalledWith("settlement_batch_item_reports");
    expect(from).toHaveBeenCalledWith("settlement_batch_items");
  });

  it("maps production settlement context and effective group assignments for pool reports", async () => {
    const reports = [
      {
        id: "report-open",
        organization_id: "org-1",
        project_id: "project-1",
        streamer_id: "streamer-1",
        live_task_id: "task-1",
        status: "approved",
        system_duration: 55,
        screenshot_duration: 60,
        settlement_duration: 60,
        time_source: "system",
        evidence_level: "green",
        settled_batch_item_id: null,
        viewers: 123,
        reviewed_at: "2026-07-12T02:00:00.000Z",
        created_at: "2026-07-12T01:00:00.000Z",
        live_tasks: {
          system_started_at: "2026-07-12T00:30:00.000Z",
          planned_start_at: "2026-07-12T00:00:00.000Z",
        },
      },
    ];
    const projectStreamers = [
      {
        id: "project-streamer-1",
        streamer_id: "streamer-1",
        hourly_rate: 80,
        base_salary: 500,
        cps_rate_bps: 1500,
        collaboration_id: "collaboration-1",
        streamers: { source_type: "organic" },
      },
    ];
    const assignments = [
      {
        id: "assignment-active",
        project_streamer_id: "project-streamer-1",
        group_id: "group-active",
        effective_from: "2026-07-01T00:00:00.000Z",
        effective_until: null,
        settlement_rule_groups: { name: "Gold" },
      },
      {
        id: "assignment-future",
        project_streamer_id: "project-streamer-1",
        group_id: "group-future",
        effective_from: "2026-08-01T00:00:00.000Z",
        effective_until: null,
        settlement_rule_groups: { name: "Future" },
      },
    ];
    const from = vi.fn((table: string) => {
      if (table === "live_reports") return createQuery(reports);
      if (table === "settlement_batch_item_reports") return createQuery([]);
      if (table === "settlement_batch_items") return createQuery([]);
      if (table === "project_streamers") return createQuery(projectStreamers);
      if (table === "project_streamer_settlement_group_assignments") {
        return createQuery(assignments);
      }
      throw new Error(`unexpected table ${table}`);
    });
    const repo = new SupabaseSettlementRepository({ from } as never);

    await expect(
      repo.listSettlementPoolReports({
        organizationId: "org-1",
        projectId: "project-1",
        batchType: "payable",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "report-open",
        systemDuration: 55,
        screenshotDuration: 60,
        viewers: 123,
        reviewedAt: "2026-07-12T02:00:00.000Z",
        liveTaskSystemStartedAt: "2026-07-12T00:30:00.000Z",
        plannedStartAt: "2026-07-12T00:00:00.000Z",
        projectStreamerId: "project-streamer-1",
        streamerSource: "organic",
        collaborationId: "collaboration-1",
        frozenHourlyRate: 80,
        frozenBaseSalary: 500,
        frozenCpsRateBps: 1500,
        settlementGroups: [
          {
            id: "group-active",
            name: "Gold",
            assignmentId: "assignment-active",
          },
        ],
      }),
    ]);
    expect(from).toHaveBeenCalledWith(
      "project_streamer_settlement_group_assignments",
    );
  });

  it("propagates duplicate aggregate link errors from atomic generation", async () => {
    const repo = new SupabaseSettlementRepository({
      rpc: vi.fn(async () => ({
        data: null,
        error: new Error("settlement_batch_report_already_linked"),
      })),
    } as never);

    await expect(
      repo.createSettlementBatchAtomic({
        organizationId: "org-1",
        projectId: "project-1",
        batchType: "payable",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        computedAmount: 0,
        manualAmount: 0,
        adjustmentAmount: 0,
        evidenceSummary: {},
        createdBy: "user-owner",
        items: [
          {
            liveReportIds: ["report-1"],
            itemType: "live_report_payable",
            computedAmount: 0,
            manualAmount: 0,
            adjustmentAmount: 0,
            evidenceSnapshot: {},
          },
        ],
      }),
    ).rejects.toThrow("settlement_batch_report_already_linked");
  });

  it("rejects duplicate report ids across aggregate items before calling the RPC", async () => {
    const rpc = vi.fn();
    const repo = new SupabaseSettlementRepository({ rpc } as never);

    await expect(
      repo.createSettlementBatchAtomic({
        organizationId: "org-1",
        projectId: "project-1",
        batchType: "payable",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        computedAmount: 0,
        manualAmount: 0,
        adjustmentAmount: 0,
        evidenceSummary: {},
        createdBy: "user-owner",
        items: [
          {
            liveReportIds: ["report-1"],
            itemType: "live_report_payable",
            computedAmount: 0,
            manualAmount: 0,
            adjustmentAmount: 0,
            evidenceSnapshot: {},
          },
          {
            liveReportId: "report-1",
            itemType: "live_report_payable",
            computedAmount: 0,
            manualAmount: 0,
            adjustmentAmount: 0,
            evidenceSnapshot: {},
          },
        ],
      }),
    ).rejects.toThrow("settlement_batch_report_duplicate_in_payload");

    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps exact one-cent exception resolution deltas through the RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        batch: { ...batchRow, computed_amount: 0.01 },
        item: { ...itemRow, computed_amount: 0.01 },
        exception: {
          id: "exception-1",
          organization_id: "org-1",
          project_id: "project-1",
          settlement_batch_id: "batch-1",
          settlement_batch_item_id: "item-1",
          live_report_id: "report-1",
          rule_version_id: "rule-version-1",
          layer_snapshot: {},
          variable_name: "salesAmountCents",
          policy: "route_item_to_review",
          status: "resolved",
          resolution_value: { moneyCents: 1 },
          resolution_reason: "Finance checked source sheet",
          created_by: "user-owner",
          resolved_by: "user-finance",
          created_at: "2026-07-12T00:00:00.000Z",
          resolved_at: "2026-07-13T00:00:00.000Z",
        },
      },
      error: null,
    }));
    const repo = new SupabaseSettlementRepository({ rpc } as never);

    const result = await repo.resolveSettlementRuleException({
      organizationId: "org-1",
      exceptionId: "exception-1",
      settlementBatchItemId: "item-1",
      oldComputedAmount: 0,
      newComputedAmount: 0.01,
      resolutionValue: { moneyCents: 1 },
      resolutionReason: "Finance checked source sheet",
      resolvedBy: "user-finance",
    });

    expect(rpc).toHaveBeenCalledWith("resolve_settlement_rule_exception", {
      p_organization_id: "org-1",
      p_exception_id: "exception-1",
      p_settlement_batch_item_id: "item-1",
      p_old_computed_amount: 0,
      p_new_computed_amount: 0.01,
      p_resolution_value: { moneyCents: 1 },
      p_resolution_reason: "Finance checked source sheet",
      p_resolved_by: "user-finance",
    });
    expect(result.batch.computedAmount).toBe(0.01);
    expect(result.item.computedAmount).toBe(0.01);
    expect(result.exception).toEqual(
      expect.objectContaining({
        id: "exception-1",
        status: "resolved",
        resolutionValue: { moneyCents: 1 },
      }),
    );
  });

  it("maps exception resolution RPC conflicts to safe service errors", async () => {
    const repo = new SupabaseSettlementRepository({
      rpc: vi.fn(async () => ({
        data: null,
        error: {
          code: "P0001",
          message:
            "Settlement rule exception was already resolved with a different value",
        },
      })),
    } as never);

    await expect(
      repo.resolveSettlementRuleException({
        organizationId: "org-1",
        exceptionId: "exception-1",
        settlementBatchItemId: "item-1",
        oldComputedAmount: 0,
        newComputedAmount: 0.01,
        resolutionValue: { moneyCents: 2 },
        resolutionReason: "Finance checked source sheet",
        resolvedBy: "user-finance",
      }),
    ).rejects.toThrow(
      "Settlement rule exception was already resolved with a different value",
    );
  });
});
