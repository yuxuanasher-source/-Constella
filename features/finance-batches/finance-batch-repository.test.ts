import { describe, expect, it, vi } from "vitest";

import {
  type FinanceBatchAdjustmentRow,
  type FinanceBatchItemRow,
  type FinanceBatchRow,
  SupabaseFinanceBatchRepository,
  listOpsFinanceBatches,
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

type MockQuery = {
  table: string;
  calls: Array<{ method: string; args: unknown[] }>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  returns: ReturnType<typeof vi.fn>;
};

function createQuery(table: string, data: unknown[]): MockQuery {
  const query = {
    table,
    calls: [] as Array<{ method: string; args: unknown[] }>,
  } as MockQuery;
  for (const method of [
    "select",
    "eq",
    "neq",
    "gte",
    "lte",
    "order",
    "in",
    "limit",
  ]) {
    query[method as keyof MockQuery] = vi.fn((...args: unknown[]) => {
      query.calls.push({ method, args });
      return query;
    }) as never;
  }
  query.maybeSingle = vi.fn(async () => ({
    data: data[0] ?? null,
    error: null,
  }));
  query.returns = vi.fn(async () => ({ data, error: null }));
  return query;
}

function createListSourcesClient(responses: Record<string, unknown[]>) {
  const queries: MockQuery[] = [];
  const client = {
    from: vi.fn((table: string) => {
      const query = createQuery(table, responses[table] ?? []);
      queries.push(query);
      return query;
    }),
  };

  return {
    client,
    queries,
    queryFor(table: string): MockQuery {
      const query = queries.find((item) => item.table === table);
      if (!query) {
        throw new Error(`Missing query for ${table}`);
      }
      return query;
    },
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
      batch: {
        ...batchRow,
        adjustment_amount: "25.35",
        final_amount: "235.35",
      },
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

describe("SupabaseFinanceBatchRepository finance batch detail reads", () => {
  it("does not filter out voided items from batch detail", async () => {
    const supabase = createListSourcesClient({
      finance_batches: [batchRow],
      finance_batch_items: [{ ...itemRow, status: "voided" }],
    });
    const repo = new SupabaseFinanceBatchRepository(supabase.client as never);

    const result = await repo.getFinanceBatchDetail({
      organizationId: "org-1",
      financeBatchId: "batch-1",
    });

    expect(result?.items).toEqual([
      expect.objectContaining({ id: "item-1", status: "voided" }),
    ]);
    expect(
      supabase.queryFor("finance_batch_items").eq,
    ).not.toHaveBeenCalledWith("status", "active");
  });
});

describe("listOpsFinanceBatches", () => {
  it("returns org-scoped ops reference batches ordered by recent updates", async () => {
    const supabase = createListSourcesClient({
      finance_batches: [batchRow],
    });

    const result = await listOpsFinanceBatches(supabase.client as never, {
      organizationId: "org-1",
    });

    const query = supabase.queryFor("finance_batches");
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining("id"));
    expect(query.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(query.order).toHaveBeenCalledWith("updated_at", {
      ascending: false,
    });
    expect(query.limit).toHaveBeenCalledWith(200);
    expect(result).toEqual([
      expect.objectContaining({
        id: "batch-1",
        type: "streamer_payable",
        title: "July streamer payable",
        finalAmount: 210,
        itemCount: 2,
      }),
    ]);
  });

  it("filters ops reference batches through finance batch items for a project", async () => {
    const supabase = createListSourcesClient({
      finance_batch_items: [
        { finance_batch_id: "batch-1" },
        { finance_batch_id: "batch-1" },
        { finance_batch_id: "batch-2" },
        { finance_batch_id: null },
      ],
      finance_batches: [batchRow],
    });

    await listOpsFinanceBatches(supabase.client as never, {
      organizationId: "org-1",
      projectId: "project-1",
    });

    const itemQuery = supabase.queryFor("finance_batch_items");
    expect(itemQuery.select).toHaveBeenCalledWith("finance_batch_id");
    expect(itemQuery.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(itemQuery.eq).toHaveBeenCalledWith("project_id", "project-1");
    expect(supabase.queryFor("finance_batches").in).toHaveBeenCalledWith("id", [
      "batch-1",
      "batch-2",
    ]);
  });

  it("returns no ops reference batches when a project has no finance batch items", async () => {
    const supabase = createListSourcesClient({
      finance_batch_items: [],
      finance_batches: [batchRow],
    });

    const result = await listOpsFinanceBatches(supabase.client as never, {
      organizationId: "org-1",
      projectId: "project-empty",
    });

    expect(result).toEqual([]);
    expect(supabase.client.from).toHaveBeenCalledTimes(1);
  });
});

describe("SupabaseFinanceBatchRepository streamer payable sources", () => {
  it("filters eligible sources and maps frozen settlement rule fields", async () => {
    const supabase = createListSourcesClient({
      live_reports: [
        {
          id: "report-eligible",
          organization_id: "org-1",
          project_id: "project-1",
          streamer_id: "streamer-1",
          settlement_duration: 120,
          time_source: "system",
          evidence_level: "green",
          created_at: "2026-07-05T12:00:00.000Z",
          projects: { name: "Project One", code: "P001" },
          streamers: { display_name: "Streamer One" },
        },
        {
          id: "report-null-duration",
          organization_id: "org-1",
          project_id: "project-1",
          streamer_id: "streamer-1",
          settlement_duration: null,
          time_source: "system",
          evidence_level: "green",
          created_at: "2026-07-05T13:00:00.000Z",
          projects: { name: "Project One", code: "P001" },
          streamers: { display_name: "Streamer One" },
        },
        {
          id: "report-new-consumed",
          organization_id: "org-1",
          project_id: "project-2",
          streamer_id: "streamer-2",
          settlement_duration: 60,
          time_source: "system",
          evidence_level: "green",
          created_at: "2026-07-05T14:00:00.000Z",
          projects: { name: "Project Two", code: "P002" },
          streamers: { display_name: "Streamer Two" },
        },
        {
          id: "report-legacy-consumed",
          organization_id: "org-1",
          project_id: "project-3",
          streamer_id: "streamer-3",
          settlement_duration: 60,
          time_source: "system",
          evidence_level: "green",
          created_at: "2026-07-05T15:00:00.000Z",
          projects: { name: "Project Three", code: "P003" },
          streamers: { display_name: "Streamer Three" },
        },
      ],
      finance_batch_items: [{ source_id: "report-new-consumed" }],
      settlement_batch_item_reports: [
        {
          live_report_id: "report-legacy-consumed",
          settlement_batch_items: {
            organization_id: "org-1",
            settlement_batches: {
              batch_type: "payable",
              status: "locked",
            },
          },
        },
      ],
      project_streamers: [
        {
          project_id: "project-1",
          streamer_id: "streamer-1",
          settlement_method: "base_salary_cpt",
          hourly_rate: "80.00",
          base_salary: "5000.00",
          cps_rate_bps: 1500,
        },
      ],
    });
    const repo = new SupabaseFinanceBatchRepository(supabase.client as never);

    const result = await repo.listStreamerPayableSources({
      organizationId: "org-1",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      projectIds: ["project-1", "project-2"],
      streamerIds: ["streamer-1", "streamer-2"],
      sourceIds: [
        "report-eligible",
        "report-null-duration",
        "report-new-consumed",
        "report-legacy-consumed",
      ],
    });

    const liveReportsQuery = supabase.queryFor("live_reports");
    expect(liveReportsQuery.select).toHaveBeenCalledWith(
      expect.stringContaining("time_source"),
    );
    expect(liveReportsQuery.eq).toHaveBeenCalledWith(
      "organization_id",
      "org-1",
    );
    expect(liveReportsQuery.eq).toHaveBeenCalledWith("status", "approved");
    expect(liveReportsQuery.eq).toHaveBeenCalledWith(
      "enter_settlement_pool",
      true,
    );
    expect(liveReportsQuery.gte).toHaveBeenCalledWith(
      "created_at",
      "2026-07-01T00:00:00.000Z",
    );
    expect(liveReportsQuery.lte).toHaveBeenCalledWith(
      "created_at",
      "2026-07-31T23:59:59.999Z",
    );
    expect(liveReportsQuery.in).toHaveBeenCalledWith("project_id", [
      "project-1",
      "project-2",
    ]);
    expect(liveReportsQuery.in).toHaveBeenCalledWith("streamer_id", [
      "streamer-1",
      "streamer-2",
    ]);
    expect(liveReportsQuery.in).toHaveBeenCalledWith("id", [
      "report-eligible",
      "report-null-duration",
      "report-new-consumed",
      "report-legacy-consumed",
    ]);

    expect(supabase.queryFor("finance_batch_items").in).toHaveBeenCalledWith(
      "source_id",
      ["report-eligible", "report-new-consumed", "report-legacy-consumed"],
    );
    expect(
      supabase.queryFor("settlement_batch_item_reports").in,
    ).toHaveBeenCalledWith("live_report_id", [
      "report-eligible",
      "report-new-consumed",
      "report-legacy-consumed",
    ]);
    expect(supabase.queryFor("project_streamers").select).toHaveBeenCalledWith(
      "project_id, streamer_id, settlement_method, hourly_rate, base_salary, cps_rate_bps",
    );

    expect(result).toEqual([
      {
        id: "report-eligible",
        organizationId: "org-1",
        projectId: "project-1",
        projectName: "Project One",
        projectCode: "P001",
        streamerId: "streamer-1",
        streamerName: "Streamer One",
        settlementDuration: 120,
        timeSource: "system",
        evidenceLevel: "green",
        createdAt: "2026-07-05T12:00:00.000Z",
        settlementMethod: "base_salary_cpt",
        hourlyRate: 80,
        baseSalary: 5000,
        cpsRateBps: 1500,
      },
    ]);
  });
});
