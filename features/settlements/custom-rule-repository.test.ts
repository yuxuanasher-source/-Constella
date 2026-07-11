import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { analyzeCustomRuleDataReadiness } from "./custom-rule-data-readiness";
import { buildCustomRuleVariableCatalog } from "./custom-rule-variable-catalog";
import {
  SupabaseCustomRuleReadRepository,
  type CustomRuleReadRepository,
} from "./custom-rule-repository";

const PERIOD_START = "2026-06-01";
const PERIOD_END = "2026-06-30";
const PERIOD_START_BOUNDARY = "2026-06-01T00:00:00.000+08:00";
const PERIOD_END_EXCLUSIVE = "2026-07-01T00:00:00.000+08:00";

describe("SupabaseCustomRuleReadRepository", () => {
  it("aggregates only schema-backed coverage metadata from paginated sources", async () => {
    const mock = createClient();
    const repository: CustomRuleReadRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const coverage = await repository.getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    expect(coverage).toMatchObject({
      hasHistory: true,
      businessTimezone: "Asia/Shanghai",
      businessTimezoneConfirmed: true,
      businessTimezoneSource: "contract_default",
      variables: {
        system_minutes: {
          numerator: 2,
          denominator: 3,
          latestSampledPeriod: {
            start: "2026-06-01T10:00:00.000Z",
            end: "2026-06-30T10:00:00.000Z",
          },
        },
        screenshot_minutes: { numerator: 2, denominator: 3 },
        settlement_minutes: { numerator: 3, denominator: 3 },
        evidence_level: { numerator: 3, denominator: 3 },
        time_source: { numerator: 3, denominator: 3 },
        views: { numerator: 2, denominator: 3 },
        live_started_at: { numerator: 2, denominator: 3 },
        approved_at: { numerator: 2, denominator: 3 },
        project_id: { numerator: 1, denominator: 1 },
        streamer_id: { numerator: 2, denominator: 2 },
        streamer_source: { numerator: 2, denominator: 2 },
        collaboration_id: { numerator: 1, denominator: 2 },
        base_hourly_rate: { numerator: 1, denominator: 2 },
        base_salary: { numerator: 2, denominator: 2 },
        cps_rate: { numerator: 2, denominator: 2 },
        gift_amount: { numerator: 1, denominator: 3 },
        supplier_fee: { numerator: 1, denominator: 3 },
        traffic_cost: { numerator: 1, denominator: 3 },
        period_payable_amount: { numerator: 2, denominator: 2 },
        period_receivable_amount: { numerator: 1, denominator: 3 },
      },
    });

    const serialized = JSON.stringify(coverage);
    expect(serialized).not.toContain("report-1");
    expect(serialized).not.toContain("streamer-a");
    expect(serialized).not.toContain("parsed_payload");
    expect(serialized).not.toContain("source_payload");
    expect(serialized).not.toContain("amount_cents");
    expect(serialized).not.toContain("computed_amount");
    expect(mock.from).toHaveBeenCalledTimes(10);
  });

  it("scopes every query by organization/project and applies supplied period boundaries", async () => {
    const mock = createClient();
    const repository = new SupabaseCustomRuleReadRepository(mock.client);

    await repository.getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    for (const table of TABLES) {
      expect(mock.calls[table]).toContainEqual([
        "eq",
        ["organization_id", "org-1"],
      ]);
      expect(mock.calls[table]).toContainEqual([
        "eq",
        ["project_id", "project-1"],
      ]);
      expect(mock.calls[table]).toContainEqual([
        "select",
        [expect.any(String), { count: "exact" }],
      ]);
      expect(mock.calls[table]).toContainEqual([
        "order",
        ["id", { ascending: false }],
      ]);
      expect(mock.calls[table]).toContainEqual([
        "order",
        ["id", { ascending: true }],
      ]);
      expect(mock.calls[table]).toContainEqual(["limit", [1]]);
      expect(mock.calls[table]).toContainEqual(["limit", [1_000]]);
      expect(mock.calls[table].filter(([method]) => method === "range")).toEqual(
        [],
      );
      for (const queryCalls of mock.queries[table]) {
        expect(queryCalls).toContainEqual([
          "eq",
          ["organization_id", "org-1"],
        ]);
        expect(queryCalls).toContainEqual([
          "eq",
          ["project_id", "project-1"],
        ]);
      }
    }

    for (const table of [
      "live_reports",
      "project_cost_items",
    ] as const) {
      expect(mock.calls[table]).toContainEqual([
        "gte",
        ["created_at", PERIOD_START_BOUNDARY],
      ]);
      expect(mock.calls[table]).toContainEqual([
        "lt",
        ["created_at", PERIOD_END_EXCLUSIVE],
      ]);
    }
    expect(mock.calls.project_streamers).toContainEqual([
      "lt",
      ["joined_at", PERIOD_END_EXCLUSIVE],
    ]);
    expect(mock.calls.settlement_batches).toContainEqual([
      "gte",
      ["period_end", "2026-06-01"],
    ]);
    expect(mock.calls.settlement_batches).toContainEqual([
      "lte",
      ["period_start", "2026-06-30"],
    ]);
    expect(mock.calls.settlement_batches).toContainEqual([
      "in",
      ["status", ["confirmed", "locked"]],
    ]);
    expect(selectFor(mock, "settlement_batches")).toBe(
      "id, batch_type, period_start, period_end",
    );
    expect(mock.calls.settlement_batch_items).toContainEqual([
      "in",
      [
        "settlement_batch_id",
        ["batch-payable-1", "batch-payable-2", "batch-receivable-1"],
      ],
    ]);
    expect(mock.calls.settlement_batch_items).not.toContainEqual([
      "gte",
      expect.any(Array),
    ]);
    expect(
      mock.calls.settlement_batch_items.filter(
        ([method, args]) => method === "lte" && args[0] !== "id",
      ),
    ).toEqual([]);
    expect(selectFor(mock, "settlement_batch_items")).not.toContain(
      "created_at",
    );
    expect(mock.calls.project_streamers).toContainEqual([
      "or",
      [`removed_at.is.null,removed_at.gte.${PERIOD_START_BOUNDARY}`],
    ]);

    expect(mock.calls.live_reports).toContainEqual([
      "eq",
      ["status", "approved"],
    ]);
    expect(selectFor(mock, "live_reports")).toContain("reviewed_at");
    expect(selectFor(mock, "live_reports")).toContain("id");
    expect(selectFor(mock, "live_reports")).toContain(
      "live_tasks!inner(system_started_at)",
    );
    expect(selectFor(mock, "live_reports")).not.toContain("approved_at");
    expect(selectFor(mock, "project_streamers")).toContain(
      "streamers!inner(source_type)",
    );
    expect(selectFor(mock, "project_streamers")).toContain("streamer_id");
    expect(mock.calls.project_cost_items).toContainEqual([
      "eq",
      ["source", "import"],
    ]);
    expect(mock.calls.project_cost_items).toContainEqual([
      "eq",
      ["status", "confirmed"],
    ]);
    expect(mock.calls.project_cost_items).toContainEqual([
      "in",
      ["item_type", ["gift", "supplier_fee", "traffic"]],
    ]);

    for (const table of TABLES) {
      expect(selectFor(mock, table)).not.toMatch(
        /parsed_payload|source_payload|raw_payload|amount_cents|computed_amount/u,
      );
    }
  });

  it("keeps sales/orders unavailable because normalized canonical fields do not exist", async () => {
    const repository = new SupabaseCustomRuleReadRepository(
      createClient().client,
    );
    const coverage = await repository.getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });
    const catalog = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage,
    });

    expect(catalog.variables.find(({ id }) => id === "sales_amount")).toMatchObject({
      availability: "unavailable",
      coverageNumerator: 0,
    });
    expect(catalog.variables.find(({ id }) => id === "orders_count")).toMatchObject({
      availability: "unavailable",
      coverageNumerator: 0,
    });
  });

  it("intersects import and settlement coverage with current approved report IDs", async () => {
    const results = defaultResults();
    results.live_reports = {
      ...results.live_reports,
      data: (results.live_reports.data ?? []).slice(0, 2).map((row, index) => ({
        ...(row as Record<string, unknown>),
        id: index === 0 ? "approved-a" : "approved-b",
      })),
      count: 2,
    };
    results.project_cost_items = {
      data: [
        {
          id: "cost-pending-1",
          item_type: "gift",
          live_report_id: "pending-c",
          created_at: "2026-06-10T00:00:00.000Z",
        },
        {
          id: "cost-pending-2",
          item_type: "gift",
          live_report_id: "pending-c",
          created_at: "2026-06-11T00:00:00.000Z",
        },
        {
          id: "cost-pending-3",
          item_type: "gift",
          live_report_id: "pending-d",
          created_at: "2026-06-12T00:00:00.000Z",
        },
        {
          id: "cost-pending-4",
          item_type: "gift",
          live_report_id: "unknown-report",
          created_at: "2026-06-13T00:00:00.000Z",
        },
        {
          id: "cost-pending-5",
          item_type: "gift",
          live_report_id: null,
          created_at: "2026-06-14T00:00:00.000Z",
        },
      ],
      count: 5,
      error: null,
    };
    results.settlement_batch_items = {
      data: [
        {
          id: "settlement-pending-1",
          settlement_batch_id: "batch-payable-1",
          streamer_id: "streamer-a",
          live_report_id: "pending-c",
        },
        {
          id: "settlement-pending-2",
          settlement_batch_id: "batch-payable-2",
          streamer_id: "streamer-b",
          live_report_id: "pending-d",
        },
        {
          id: "settlement-pending-3",
          settlement_batch_id: "batch-receivable-1",
          streamer_id: null,
          live_report_id: "unknown-report",
        },
        {
          id: "settlement-pending-4",
          settlement_batch_id: "batch-receivable-1",
          streamer_id: null,
          live_report_id: null,
        },
      ],
      count: 4,
      error: null,
    };
    const coverage = await new SupabaseCustomRuleReadRepository(
      createClient(results).client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(coverage.variables.gift_amount).toMatchObject({
      numerator: 0,
      denominator: 2,
    });
    expect(coverage.variables.period_payable_amount).toMatchObject({
      numerator: 0,
      denominator: 2,
    });
    expect(coverage.variables.period_receivable_amount).toMatchObject({
      numerator: 0,
      denominator: 2,
    });
  });

  it("uses approved reports for receivables and additionally intersects payable streamers", async () => {
    const results = defaultResults();
    results.settlement_batch_items = {
      data: [
        {
          id: "intersection-1",
          settlement_batch_id: "batch-payable-1",
          streamer_id: "streamer-a",
          live_report_id: "report-1",
        },
        {
          id: "intersection-2",
          settlement_batch_id: "batch-payable-1",
          streamer_id: "streamer-a",
          live_report_id: "report-1",
        },
        {
          id: "intersection-3",
          settlement_batch_id: "batch-payable-2",
          streamer_id: "streamer-foreign",
          live_report_id: "report-2",
        },
        {
          id: "intersection-4",
          settlement_batch_id: "batch-payable-2",
          streamer_id: null,
          live_report_id: "report-2",
        },
        {
          id: "intersection-5",
          settlement_batch_id: "batch-payable-2",
          streamer_id: "streamer-b",
          live_report_id: "report-unknown",
        },
        {
          id: "intersection-6",
          settlement_batch_id: "batch-receivable-1",
          streamer_id: null,
          live_report_id: "report-1",
        },
        {
          id: "intersection-7",
          settlement_batch_id: "batch-receivable-1",
          streamer_id: "streamer-foreign",
          live_report_id: "report-2",
        },
        {
          id: "intersection-8",
          settlement_batch_id: "batch-receivable-1",
          streamer_id: null,
          live_report_id: "report-foreign",
        },
      ],
      count: 8,
      error: null,
    };

    const coverage = await new SupabaseCustomRuleReadRepository(
      createClient(results).client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(coverage.variables.period_payable_amount).toMatchObject({
      numerator: 1,
      denominator: 2,
    });
    expect(coverage.variables.period_receivable_amount).toMatchObject({
      numerator: 2,
      denominator: 3,
    });
  });

  it("returns no-history metadata without converting it into a query failure", async () => {
    const mock = createClient(emptyResults());
    const repository = new SupabaseCustomRuleReadRepository(mock.client);

    const coverage = await repository.getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-new",
    });

    expect(coverage).toMatchObject({
      hasHistory: false,
      variables: {
        system_minutes: {
          numerator: 0,
          denominator: 0,
          latestSampledPeriod: null,
        },
        approved_at: { numerator: 0, denominator: 0 },
        project_id: { numerator: 1, denominator: 1 },
        gift_amount: { numerator: 0, denominator: 0 },
      },
    });
    expect(mock.from).toHaveBeenCalledTimes(4);
    expect(mock.calls.settlement_batch_items).toEqual([]);
  });

  it("converts business-date report boundaries in the resolved IANA timezone", async () => {
    const mock = createClient();
    const repository = new SupabaseCustomRuleReadRepository(mock.client, {
      resolvedBusinessTimezone: {
        value: "America/New_York",
        confirmed: true,
        source: "confirmed_contract",
      },
    });

    await repository.getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
      periodStart: "2026-03-08",
      periodEnd: "2026-03-08",
    });

    for (const table of [
      "live_reports",
      "project_cost_items",
    ] as const) {
      expect(mock.calls[table]).toContainEqual([
        "gte",
        ["created_at", "2026-03-08T00:00:00.000-05:00"],
      ]);
      expect(mock.calls[table]).toContainEqual([
        "lt",
        ["created_at", "2026-03-09T00:00:00.000-04:00"],
      ]);
    }
    expect(mock.calls.project_streamers).toContainEqual([
      "lt",
      ["joined_at", "2026-03-09T00:00:00.000-04:00"],
    ]);
    expect(mock.calls.project_streamers).toContainEqual([
      "or",
      [
        "removed_at.is.null,removed_at.gte.2026-03-08T00:00:00.000-05:00",
      ],
    ]);
    expect(mock.calls.settlement_batches).toContainEqual([
      "gte",
      ["period_end", "2026-03-08"],
    ]);
    expect(mock.calls.settlement_batches).toContainEqual([
      "lte",
      ["period_start", "2026-03-08"],
    ]);
  });

  it("does not issue an unbounded settlement-item query when no batch overlaps", async () => {
    const results = defaultResults();
    results.settlement_batches = { data: [], count: 0, error: null };
    const mock = createClient(results);
    const coverage = await new SupabaseCustomRuleReadRepository(
      mock.client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    expect(mock.calls.settlement_batch_items).toEqual([]);
    expect(coverage.variables.period_payable_amount.numerator).toBe(0);
    expect(coverage.variables.period_receivable_amount.numerator).toBe(0);
  });

  it("fails closed on query errors and identifies the failed source", async () => {
    const databaseError = new Error("database unavailable");
    const repository = new SupabaseCustomRuleReadRepository(
      createClient({
        ...defaultResults(),
        live_reports: { data: null, count: null, error: databaseError },
      }).client,
    );

    await expect(
      repository.getProjectVariableCoverage({
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_COVERAGE_QUERY_FAILED",
      source: "live_reports",
      cause: databaseError,
    });
  });

  it("fails closed when the settlement-batch period query fails", async () => {
    const databaseError = new Error("batch query unavailable");
    const results = defaultResults();
    results.settlement_batches = {
      data: null,
      count: null,
      error: databaseError,
    };
    const mock = createClient(results);

    await expect(
      new SupabaseCustomRuleReadRepository(
        mock.client,
      ).getProjectVariableCoverage({
        organizationId: "org-1",
        projectId: "project-1",
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_COVERAGE_QUERY_FAILED",
      source: "settlement_batches",
      cause: databaseError,
    });
    expect(mock.calls.settlement_batch_items).toEqual([]);
  });

  it.each([
    ["empty organization", { organizationId: " ", projectId: "project-1" }],
    ["empty project", { organizationId: "org-1", projectId: "" }],
    [
      "invalid start",
      {
        organizationId: "org-1",
        projectId: "project-1",
        periodStart: "not-a-date",
      },
    ],
    [
      "reversed period",
      {
        organizationId: "org-1",
        projectId: "project-1",
        periodStart: PERIOD_END,
        periodEnd: PERIOD_START,
      },
    ],
    [
      "offset timestamp",
      {
        organizationId: "org-1",
        projectId: "project-1",
        periodStart: "2026-06-01T00:00:00+08:00",
      },
    ],
    [
      "impossible calendar date",
      {
        organizationId: "org-1",
        projectId: "project-1",
        periodStart: "2026-02-30",
      },
    ],
    [
      "T24 time",
      {
        organizationId: "org-1",
        projectId: "project-1",
        periodEnd: "2026-06-01T24:00:00+08:00",
      },
    ],
    [
      "unknown key",
      {
        organizationId: "org-1",
        projectId: "project-1",
        extra: true,
      },
    ],
  ])("rejects %s before issuing a query", async (_label, input) => {
    const mock = createClient();
    const repository = new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.getProjectVariableCoverage(input),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_COVERAGE_INPUT_INVALID" });
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("rejects inherited/accessor input without invoking the accessor", async () => {
    const mock = createClient();
    const repository = new SupabaseCustomRuleReadRepository(mock.client);
    const inherited = Object.create({
      organizationId: "org-1",
      projectId: "project-1",
    }) as {
      organizationId: string;
      projectId: string;
    };
    let reads = 0;
    const accessorInput = { projectId: "project-1" };
    Object.defineProperty(accessorInput, "organizationId", {
      enumerable: true,
      get() {
        reads += 1;
        return "org-1";
      },
    });

    await expect(
      repository.getProjectVariableCoverage(inherited),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_COVERAGE_INPUT_INVALID" });
    await expect(
      repository.getProjectVariableCoverage(
        accessorInput as { organizationId: string; projectId: string },
      ),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_COVERAGE_INPUT_INVALID" });
    expect(reads).toBe(0);
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("reads 1001 rows with a fixed high-water and 1000 + 1 keyset pages", async () => {
    const results = defaultResults();
    results.live_reports = {
      data: approvedReportRows(1_001),
      count: 1_001,
      error: null,
    };
    const mock = createClient(results);

    const coverage = await new SupabaseCustomRuleReadRepository(
      mock.client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(coverage.variables.system_minutes).toMatchObject({
      numerator: 1_001,
      denominator: 1_001,
    });
    expect(mock.calls.live_reports.filter(([method]) => method === "range")).toEqual([]);
    expect(mock.calls.live_reports.filter(([method]) => method === "limit")).toEqual([
      ["limit", [1]],
      ["limit", [1_000]],
      ["limit", [1_000]],
    ]);
    expect(mock.calls.live_reports).toContainEqual([
      "gt",
      ["id", "report-001000"],
    ]);
    expect(
      mock.calls.live_reports.filter(
        ([method, args]) =>
          method === "lte" && args[0] === "id" && args[1] === "report-001001",
      ),
    ).toHaveLength(2);
    expect(
      mock.from.mock.calls.filter(([table]) => table === "live_reports"),
    ).toHaveLength(3);
  });

  it("uses one page at the exact 1000-row boundary", async () => {
    const results = defaultResults();
    results.live_reports = {
      data: approvedReportRows(1_000),
      count: 1_000,
      error: null,
    };
    const mock = createClient(results);

    await new SupabaseCustomRuleReadRepository(
      mock.client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(mock.calls.live_reports.filter(([method]) => method === "range")).toEqual([]);
    expect(mock.calls.live_reports.filter(([method]) => method === "limit")).toEqual([
      ["limit", [1]],
      ["limit", [1_000]],
    ]);
    expect(mock.calls.live_reports.filter(([method]) => method === "gt")).toEqual([]);
  });

  it.each([
    [
      "duplicate page",
      {
        1: { data: [approvedReportRows(1)[0]] },
      },
    ],
    [
      "short first page",
      {
        0: { data: approvedReportRows(999) },
      },
    ],
    [
      "count drift",
      {
        1: { count: 2 },
      },
    ],
    [
      "non-monotonic first page",
      {
        0: { data: approvedReportRows(1_000).reverse() },
      },
    ],
  ] as const)("fails closed on %s pagination anomalies", async (_label, pages) => {
    const results = defaultResults();
    results.live_reports = {
      data: approvedReportRows(1_001),
      count: 1_001,
      error: null,
      pages: pages as Record<number, MockPageOverride>,
    };

    await expect(
      new SupabaseCustomRuleReadRepository(
        createClient(results).client,
      ).getProjectVariableCoverage({
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_COVERAGE_PAGE_INVALID",
      source: "live_reports",
    });
  });

  it("fails closed when a later page query fails", async () => {
    const pageError = new Error("second page unavailable");
    const results = defaultResults();
    results.live_reports = {
      data: approvedReportRows(1_001),
      count: 1_001,
      error: null,
      pages: { 1: { error: pageError } },
    };

    await expect(
      new SupabaseCustomRuleReadRepository(
        createClient(results).client,
      ).getProjectVariableCoverage({
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_COVERAGE_QUERY_FAILED",
      source: "live_reports",
      cause: pageError,
    });
  });

  it("excludes IDs inserted above the fixed high-water", async () => {
    const results = defaultResults();
    results.live_reports = {
      data: approvedReportRows(1_001),
      count: 1_001,
      error: null,
      afterHighWater(result) {
        result.data = [
          ...(result.data ?? []),
          approvedReportRow("report-999999"),
        ];
      },
    };
    const mock = createClient(results);

    const coverage = await new SupabaseCustomRuleReadRepository(
      mock.client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(coverage.variables.system_minutes).toMatchObject({
      numerator: 1_001,
      denominator: 1_001,
    });
    expect(mock.calls.live_reports).toContainEqual([
      "lte",
      ["id", "report-001001"],
    ]);
  });

  it("fails closed when deletion plus a new high ID drifts the snapshot", async () => {
    const results = defaultResults();
    results.live_reports = {
      data: approvedReportRows(1_001),
      count: 1_001,
      error: null,
      afterHighWater(result) {
        result.data = [
          ...(result.data ?? []).filter(
            (row) => rowOrderValue(row, "id") !== "report-000500",
          ),
          approvedReportRow("report-999999"),
        ];
      },
    };

    await expect(
      new SupabaseCustomRuleReadRepository(
        createClient(results).client,
      ).getProjectVariableCoverage({
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_COVERAGE_PAGE_INVALID",
      source: "live_reports",
    });
  });

  it("chunks settlement batch IDs for independently bounded item snapshots", async () => {
    const results = defaultResults();
    const batches = settlementBatchRows(205);
    results.settlement_batches = {
      data: batches,
      count: batches.length,
      error: null,
    };
    results.settlement_batch_items = {
      data: batches.map((batch, index) => ({
        id: `settlement-item-${String(index + 1).padStart(6, "0")}`,
        settlement_batch_id: rowOrderValue(batch, "id"),
        streamer_id: "streamer-a",
        live_report_id: `report-${(index % 3) + 1}`,
      })),
      count: batches.length,
      error: null,
    };
    const mock = createClient(results);

    await new SupabaseCustomRuleReadRepository(
      mock.client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });

    const itemChunks = mock.queries.settlement_batch_items.map((queryCalls) => {
      const chunkCall = queryCalls.find(
        ([method, args]) =>
          method === "in" && args[0] === "settlement_batch_id",
      );
      expect(chunkCall).toBeDefined();
      const ids = chunkCall?.[1][1] as readonly unknown[];
      expect(ids.length).toBeLessThanOrEqual(100);
      expect(queryCalls).toContainEqual([
        "eq",
        ["organization_id", "org-1"],
      ]);
      expect(queryCalls).toContainEqual([
        "eq",
        ["project_id", "project-1"],
      ]);
      return ids;
    });
    expect(itemChunks).toHaveLength(6);
    expect(new Set(itemChunks.map((ids) => JSON.stringify(ids))).size).toBe(3);
  });

  it("enforces the global settlement-item limit across chunks", async () => {
    const results = defaultResults();
    const batches = settlementBatchRows(101);
    const items = [
      ...Array.from({ length: 4_950 }, (_, index) => ({
        id: `settlement-item-a-${String(index + 1).padStart(6, "0")}`,
        settlement_batch_id: "batch-000001",
        streamer_id: "streamer-a",
        live_report_id: "report-1",
      })),
      ...Array.from({ length: 51 }, (_, index) => ({
        id: `settlement-item-b-${String(index + 1).padStart(6, "0")}`,
        settlement_batch_id: "batch-000101",
        streamer_id: "streamer-a",
        live_report_id: "report-1",
      })),
    ];
    results.settlement_batches = {
      data: batches,
      count: batches.length,
      error: null,
    };
    results.settlement_batch_items = {
      data: items,
      count: items.length,
      error: null,
    };

    await expect(
      new SupabaseCustomRuleReadRepository(
        createClient(results).client,
      ).getProjectVariableCoverage({
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_COVERAGE_LIMIT_EXCEEDED",
      source: "settlement_batch_items",
    });
  });

  it.each([
    [5_001, "CUSTOM_RULE_COVERAGE_LIMIT_EXCEEDED"],
    [1.5, "CUSTOM_RULE_COVERAGE_COUNT_INVALID"],
    [Number.MAX_SAFE_INTEGER + 1, "CUSTOM_RULE_COVERAGE_COUNT_INVALID"],
  ])("rejects unsafe/excessive exact count %s", async (count, code) => {
    const repository = new SupabaseCustomRuleReadRepository(
      createClient({
        ...defaultResults(),
        live_reports: {
          data: defaultResults().live_reports.data,
          count,
          error: null,
        },
      }).client,
    );

    await expect(
      repository.getProjectVariableCoverage({
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ).rejects.toMatchObject({ code });
  });

  it("is deterministic when database row order changes", async () => {
    const results = defaultResults();
    const reversedResults = Object.fromEntries(
      Object.entries(results).map(([table, result]) => [
        table,
        {
          ...result,
          data: result.data ? [...result.data].reverse() : result.data,
        },
      ]),
    ) as MockResults;
    const forward = await new SupabaseCustomRuleReadRepository(
      createClient(results).client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });
    const reverse = await new SupabaseCustomRuleReadRepository(
      createClient(reversedResults).client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(reverse).toEqual(forward);
  });

  it("propagates explicit timezone provenance into catalog/readiness freshness", async () => {
    const client = createClient().client;
    const shanghaiCoverage = await new SupabaseCustomRuleReadRepository(
      client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });
    const tokyoCoverage = await new SupabaseCustomRuleReadRepository(client, {
      resolvedBusinessTimezone: {
        value: "Asia/Tokyo",
        confirmed: true,
        source: "confirmed_contract",
      },
    }).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });
    const shanghaiCatalog = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: shanghaiCoverage,
    });
    const tokyoCatalog = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: tokyoCoverage,
    });
    const shanghaiReadiness = analyzeCustomRuleDataReadiness({
      catalog: shanghaiCatalog,
      inputs: [{ variableId: "weekday", required: true }],
    });
    const tokyoReadiness = analyzeCustomRuleDataReadiness({
      catalog: tokyoCatalog,
      inputs: [{ variableId: "weekday", required: true }],
    });

    expect(shanghaiCoverage.businessTimezoneSource).toBe("contract_default");
    expect(tokyoCoverage.businessTimezoneSource).toBe("confirmed_contract");
    expect(tokyoCatalog.businessTimezoneSource).toBe("confirmed_contract");
    expect(tokyoReadiness.businessTimezoneSource).toBe("confirmed_contract");
    expect(tokyoCatalog.version).not.toBe(shanghaiCatalog.version);
    expect(tokyoReadiness.readinessHash).not.toBe(
      shanghaiReadiness.readinessHash,
    );
  });

  it("does not confirm an invalid resolved timezone", async () => {
    const coverage = await new SupabaseCustomRuleReadRepository(
      createClient().client,
      {
        resolvedBusinessTimezone: {
          value: "Mars/Olympus",
          confirmed: true,
          source: "confirmed_contract",
        },
      },
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });
    const catalog = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage,
    });

    expect(coverage.businessTimezoneConfirmed).toBe(false);
    expect(catalog.variables.find(({ id }) => id === "weekday")).toMatchObject({
      availability: "unavailable",
    });
  });

  it("does not confirm a valid IANA value with unresolved provenance", async () => {
    const coverage = await new SupabaseCustomRuleReadRepository(
      createClient().client,
      {
        resolvedBusinessTimezone: {
          value: "Asia/Shanghai",
          confirmed: true,
          source: "unresolved",
        },
      },
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(coverage).toMatchObject({
      businessTimezone: "Asia/Shanghai",
      businessTimezoneSource: "unresolved",
      businessTimezoneConfirmed: false,
    });
  });

  it("rejects period filtering when the business timezone is unresolved", async () => {
    const mock = createClient();
    const repository = new SupabaseCustomRuleReadRepository(mock.client, {
      resolvedBusinessTimezone: {
        value: "Asia/Shanghai",
        confirmed: true,
        source: "unresolved",
      },
    });

    await expect(
      repository.getProjectVariableCoverage({
        organizationId: "org-1",
        projectId: "project-1",
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_COVERAGE_INPUT_INVALID",
    });
    expect(mock.from).not.toHaveBeenCalled();
  });
});

const TABLES = [
  "live_reports",
  "project_streamers",
  "project_cost_items",
  "settlement_batches",
  "settlement_batch_items",
] as const;
type TableName = (typeof TABLES)[number];
type QueryCall = [
  | "select"
  | "eq"
  | "in"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "or"
  | "not"
  | "order"
  | "range"
  | "limit"
  | "returns",
  unknown[],
];
type MockResult = {
  data: unknown[] | null;
  count: number | null;
  error: Error | null;
  pages?: Record<number, MockPageOverride>;
  highWater?: MockPageOverride;
  afterHighWater?: (result: MockResult) => void;
};
type MockPageOverride = {
  data?: unknown[] | null;
  count?: number | null;
  error?: Error | null;
};
type MockResults = Record<TableName, MockResult>;
type MockQuery = {
  select(columns: string, options: { count: "exact" }): MockQuery;
  eq(column: string, value: unknown): MockQuery;
  in(column: string, values: readonly unknown[]): MockQuery;
  gt(column: string, value: string): MockQuery;
  gte(column: string, value: string): MockQuery;
  lt(column: string, value: string): MockQuery;
  lte(column: string, value: string): MockQuery;
  or(filter: string): MockQuery;
  not(column: string, operator: string, value: unknown): MockQuery;
  order(column: string, options: { ascending: boolean }): MockQuery;
  range(from: number, to: number): MockQuery;
  limit(count: number): MockQuery;
  returns(): Promise<MockResult>;
};

function createClient(results: MockResults = defaultResults()) {
  const calls = Object.fromEntries(
    TABLES.map((table) => [table, [] as QueryCall[]]),
  ) as Record<TableName, QueryCall[]>;
  const queries = Object.fromEntries(
    TABLES.map((table) => [table, [] as QueryCall[][]]),
  ) as Record<TableName, QueryCall[][]>;
  const state = {
    pageReads: Object.fromEntries(
      TABLES.map((table) => [table, 0]),
    ) as Record<TableName, number>,
    highWaterReads: Object.fromEntries(
      TABLES.map((table) => [table, 0]),
    ) as Record<TableName, number>,
  };
  const from = vi.fn((table: TableName) => {
    const queryCalls: QueryCall[] = [];
    queries[table].push(queryCalls);
    return createQuery(table, calls, queryCalls, results, state);
  });

  return {
    client: { from } as unknown as SupabaseClient,
    calls,
    queries,
    from,
  };
}

function createQuery(
  table: TableName,
  calls: Record<TableName, QueryCall[]>,
  queryCalls: QueryCall[],
  results: MockResults,
  state: {
    pageReads: Record<TableName, number>;
    highWaterReads: Record<TableName, number>;
  },
): MockQuery {
  let selectedRange: { from: number; to: number } | null = null;
  let selectedOrder: { column: string; ascending: boolean } | null = null;
  let selectedColumns = "";
  let selectedLimit: number | null = null;
  let idGreaterThan: string | null = null;
  let idLessThanOrEqual: string | null = null;
  let settlementBatchIds: readonly unknown[] | null = null;
  const record = (
    method: QueryCall[0],
    args: unknown[],
  ): MockQuery => {
    const call: QueryCall = [method, args];
    calls[table].push(call);
    queryCalls.push(call);
    return query;
  };
  const query: MockQuery = {
    select: (columns, options) => {
      selectedColumns = columns;
      return record("select", [columns, options]);
    },
    eq: (column, value) => record("eq", [column, value]),
    in: (column, values) => {
      if (column === "settlement_batch_id") {
        settlementBatchIds = values;
      }
      return record("in", [column, values]);
    },
    gt: (column, value) => {
      if (column === "id") {
        idGreaterThan = value;
      }
      return record("gt", [column, value]);
    },
    gte: (column, value) => record("gte", [column, value]),
    lt: (column, value) => record("lt", [column, value]),
    lte: (column, value) => {
      if (column === "id") {
        idLessThanOrEqual = value;
      }
      return record("lte", [column, value]);
    },
    or: (filter) => record("or", [filter]),
    not: (column, operator, value) =>
      record("not", [column, operator, value]),
    order: (column, options) => {
      selectedOrder = { column, ascending: options.ascending };
      return record("order", [column, options]);
    },
    range: (from, to) => {
      selectedRange = { from, to };
      return record("range", [from, to]);
    },
    limit: (count) => {
      selectedLimit = count;
      return record("limit", [count]);
    },
    returns: async () => {
      const returnsCall: QueryCall = ["returns", []];
      calls[table].push(returnsCall);
      queryCalls.push(returnsCall);
      const base = results[table];
      const isHighWater =
        selectedColumns === "id" &&
        selectedOrder?.ascending === false &&
        selectedLimit === 1;
      const pageIndex = isHighWater ? null : state.pageReads[table]++;
      const override = isHighWater
        ? base.highWater
        : pageIndex === null
          ? undefined
          : base.pages?.[pageIndex];
      const filteredData = filterRows(base.data, {
        idGreaterThan,
        idLessThanOrEqual,
        settlementBatchIds,
      });
      const hasCardinalityFilter =
        idGreaterThan !== null ||
        idLessThanOrEqual !== null ||
        settlementBatchIds !== null;
      const filteredCount =
        hasCardinalityFilter && filteredData
          ? filteredData.length
          : base.count;
      const orderedData = selectedOrder
        ? orderRows(filteredData, selectedOrder)
        : filteredData;
      const boundedData = selectedRange && orderedData
        ? orderedData.slice(selectedRange.from, selectedRange.to + 1)
        : selectedLimit !== null && orderedData
          ? orderedData.slice(0, selectedLimit)
          : orderedData;
      const unsafeData = hasOwn(override, "data")
        ? override?.data ?? null
        : boundedData;
      const data = selectedColumns === "id" && unsafeData
        ? unsafeData.map((row) => ({ id: rowOrderValue(row, "id") }))
        : unsafeData;
      const result = {
        data,
        count: hasOwn(override, "count")
          ? override?.count ?? null
          : filteredCount,
        error: hasOwn(override, "error")
          ? override?.error ?? null
          : base.error,
      };
      if (isHighWater) {
        state.highWaterReads[table] += 1;
        base.afterHighWater?.(base);
      }
      return result;
    },
  };
  return query;
}

function filterRows(
  rows: unknown[] | null,
  filters: {
    idGreaterThan: string | null;
    idLessThanOrEqual: string | null;
    settlementBatchIds: readonly unknown[] | null;
  },
): unknown[] | null {
  if (!rows) {
    return rows;
  }
  return rows.filter((row) => {
    const id = rowOrderValue(row, "id");
    if (filters.idGreaterThan && id.localeCompare(filters.idGreaterThan) <= 0) {
      return false;
    }
    if (
      filters.idLessThanOrEqual &&
      id.localeCompare(filters.idLessThanOrEqual) > 0
    ) {
      return false;
    }
    if (filters.settlementBatchIds) {
      const batchId = rowOrderValue(row, "settlement_batch_id");
      return filters.settlementBatchIds.includes(batchId);
    }
    return true;
  });
}

function hasOwn(
  value: object | null | undefined,
  key: PropertyKey,
): boolean {
  return value !== null && value !== undefined && Object.hasOwn(value, key);
}

function orderRows(
  rows: unknown[] | null,
  order: { column: string; ascending: boolean },
): unknown[] | null {
  if (!rows) {
    return rows;
  }
  return [...rows].sort((left, right) => {
    const leftValue = rowOrderValue(left, order.column);
    const rightValue = rowOrderValue(right, order.column);
    const comparison = leftValue.localeCompare(rightValue);
    return order.ascending ? comparison : -comparison;
  });
}

function rowOrderValue(row: unknown, column: string): string {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return "";
  }
  const value = (row as Record<string, unknown>)[column];
  return typeof value === "string" ? value : "";
}

function selectFor(mock: ReturnType<typeof createClient>, table: TableName) {
  const selects = mock.calls[table].filter(([method]) => method === "select");
  const call =
    selects.find(([, args]) => String(args[0]) !== "id") ?? selects[0];
  return String(call?.[1][0] ?? "");
}

function emptyResults(): MockResults {
  return Object.fromEntries(
    TABLES.map((table) => [
      table,
      { data: [], count: 0, error: null },
    ]),
  ) as unknown as MockResults;
}

function defaultResults(): MockResults {
  return {
    live_reports: {
      data: [
        {
          id: "report-1",
          system_duration: 60,
          screenshot_duration: 58,
          settlement_duration: 60,
          evidence_level: "green",
          time_source: "system",
          viewers: 100,
          reviewed_at: "2026-06-02T10:00:00.000Z",
          created_at: "2026-06-01T10:00:00.000Z",
          live_tasks: {
            system_started_at: "2026-06-01T09:00:00.000Z",
          },
        },
        {
          id: "report-2",
          system_duration: null,
          screenshot_duration: 40,
          settlement_duration: 45,
          evidence_level: "yellow",
          time_source: "screenshot",
          viewers: null,
          reviewed_at: "2026-06-15T10:00:00.000Z",
          created_at: "2026-06-14T10:00:00.000Z",
          live_tasks: [{ system_started_at: null }],
        },
        {
          id: "report-3",
          system_duration: 30,
          screenshot_duration: null,
          settlement_duration: 30,
          evidence_level: "red",
          time_source: "system",
          viewers: 20,
          reviewed_at: null,
          created_at: "2026-06-30T10:00:00.000Z",
          live_tasks: {
            system_started_at: "2026-06-30T09:00:00.000Z",
          },
        },
      ],
      count: 3,
      error: null,
    },
    project_streamers: {
      data: [
        {
          id: "project-streamer-1",
          streamer_id: "streamer-a",
          hourly_rate: 8_000,
          base_salary: 0,
          cps_rate_bps: 1_500,
          collaboration_id: "collab-1",
          joined_at: "2026-05-01T00:00:00.000Z",
          removed_at: null,
          streamers: { source_type: "internal" },
        },
        {
          id: "project-streamer-2",
          streamer_id: "streamer-b",
          hourly_rate: null,
          base_salary: 5_000,
          cps_rate_bps: 0,
          collaboration_id: null,
          joined_at: "2026-06-05T00:00:00.000Z",
          removed_at: null,
          streamers: [{ source_type: "external" }],
        },
      ],
      count: 2,
      error: null,
    },
    project_cost_items: {
      data: [
        {
          id: "cost-1",
          item_type: "gift",
          live_report_id: "report-1",
          created_at: "2026-06-10T00:00:00.000Z",
        },
        {
          id: "cost-2",
          item_type: "gift",
          live_report_id: "report-1",
          created_at: "2026-06-11T00:00:00.000Z",
        },
        {
          id: "cost-3",
          item_type: "gift",
          live_report_id: null,
          created_at: "2026-06-12T00:00:00.000Z",
        },
        {
          id: "cost-4",
          item_type: "supplier_fee",
          live_report_id: "report-2",
          created_at: "2026-06-13T00:00:00.000Z",
        },
        {
          id: "cost-5",
          item_type: "traffic",
          live_report_id: "report-3",
          created_at: "2026-06-14T00:00:00.000Z",
        },
      ],
      count: 5,
      error: null,
    },
    settlement_batches: {
      data: [
        {
          id: "batch-payable-1",
          batch_type: "payable",
          status: "locked",
          period_start: "2026-06-01",
          period_end: "2026-06-15",
        },
        {
          id: "batch-payable-2",
          batch_type: "payable",
          status: "confirmed",
          period_start: "2026-06-16",
          period_end: "2026-06-30",
        },
        {
          id: "batch-receivable-1",
          batch_type: "receivable",
          status: "locked",
          period_start: "2026-06-01",
          period_end: "2026-06-30",
        },
      ],
      count: 3,
      error: null,
    },
    settlement_batch_items: {
      data: [
        {
          id: "settlement-item-1",
          settlement_batch_id: "batch-payable-1",
          streamer_id: "streamer-a",
          live_report_id: "report-1",
        },
        {
          id: "settlement-item-2",
          settlement_batch_id: "batch-payable-2",
          streamer_id: "streamer-b",
          live_report_id: "report-2",
        },
        {
          id: "settlement-item-3",
          settlement_batch_id: "batch-receivable-1",
          streamer_id: "streamer-a",
          live_report_id: "report-1",
        },
      ],
      count: 3,
      error: null,
    },
  };
}

function approvedReportRows(count: number): unknown[] {
  return Array.from({ length: count }, (_, index) =>
    approvedReportRow(
      `report-${String(index + 1).padStart(6, "0")}`,
    ),
  );
}

function approvedReportRow(id: string): unknown {
  return {
    id,
    system_duration: 60,
    screenshot_duration: 60,
    settlement_duration: 60,
    evidence_level: "green",
    time_source: "system",
    viewers: 100,
    reviewed_at: "2026-06-02T10:00:00.000Z",
    created_at: "2026-06-01T10:00:00.000Z",
    live_tasks: { system_started_at: "2026-06-01T09:00:00.000Z" },
  };
}

function settlementBatchRows(count: number): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `batch-${String(index + 1).padStart(6, "0")}`,
    batch_type: "payable",
    status: "locked",
    period_start: "2026-06-01",
    period_end: "2026-06-30",
  }));
}
