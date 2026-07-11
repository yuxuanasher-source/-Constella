import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assertCoverageCounts,
  isConfirmedIanaTimezone,
  normalizeCustomRuleBusinessTimezoneSource,
  type CustomRuleBusinessTimezoneSource,
  type CustomRuleLatestSampledPeriod,
  type CustomRuleVariableCoverage,
  type ProjectVariableCoverage,
} from "./custom-rule-variable-catalog";

/** Canonical Gregorian business date, validated at runtime as YYYY-MM-DD. */
export type CustomRuleBusinessDate = string;

export type GetProjectVariableCoverageInput = {
  organizationId: string;
  projectId: string;
  periodStart?: CustomRuleBusinessDate;
  periodEnd?: CustomRuleBusinessDate;
};

export type CustomRuleReadRepository = {
  getProjectVariableCoverage(
    input: GetProjectVariableCoverageInput,
  ): Promise<ProjectVariableCoverage>;
};

export type ResolvedCustomRuleBusinessTimezone = {
  value: string | null;
  confirmed: boolean;
  source: CustomRuleBusinessTimezoneSource;
};

export type SupabaseCustomRuleReadRepositoryOptions = {
  maxRowsPerSource?: number;
  resolvedBusinessTimezone?: ResolvedCustomRuleBusinessTimezone;
};

export class CustomRuleCoverageInputError extends TypeError {
  readonly code = "CUSTOM_RULE_COVERAGE_INPUT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "CustomRuleCoverageInputError";
  }
}

export class CustomRuleCoverageQueryError extends Error {
  readonly code = "CUSTOM_RULE_COVERAGE_QUERY_FAILED";

  constructor(
    readonly source: CoverageSource,
    readonly cause: unknown,
  ) {
    super(`Failed to read custom-rule coverage source: ${source}`);
    this.name = "CustomRuleCoverageQueryError";
  }
}

export class CustomRuleCoverageCountError extends Error {
  readonly code = "CUSTOM_RULE_COVERAGE_COUNT_INVALID";

  constructor(readonly source: CoverageSource, message: string) {
    super(`${source}: ${message}`);
    this.name = "CustomRuleCoverageCountError";
  }
}

export class CustomRuleCoverageLimitError extends Error {
  readonly code = "CUSTOM_RULE_COVERAGE_LIMIT_EXCEEDED";

  constructor(readonly source: CoverageSource, readonly limit: number) {
    super(`${source}: exact row count exceeds the bounded limit of ${limit}`);
    this.name = "CustomRuleCoverageLimitError";
  }
}

export class CustomRuleCoveragePageError extends Error {
  readonly code = "CUSTOM_RULE_COVERAGE_PAGE_INVALID";

  constructor(readonly source: CoverageSource, message: string) {
    super(`${source}: ${message}`);
    this.name = "CustomRuleCoveragePageError";
  }
}

type CoverageSource =
  | "live_reports"
  | "project_streamers"
  | "project_cost_items"
  | "settlement_batches"
  | "settlement_batch_items";

type LiveTaskRelation =
  | { system_started_at: string | null }
  | Array<{ system_started_at: string | null }>
  | null;

type LiveReportCoverageRow = {
  id: string;
  system_duration: number | null;
  screenshot_duration: number | null;
  settlement_duration: number | null;
  evidence_level: string | null;
  time_source: string | null;
  viewers: number | null;
  reviewed_at: string | null;
  created_at: string;
  live_tasks: LiveTaskRelation;
};

type StreamerRelation =
  | { source_type: string | null }
  | Array<{ source_type: string | null }>
  | null;

type ProjectStreamerCoverageRow = {
  id: string;
  streamer_id: string;
  hourly_rate: number | null;
  base_salary: number | null;
  cps_rate_bps: number | null;
  collaboration_id: string | null;
  joined_at: string | null;
  removed_at: string | null;
  streamers: StreamerRelation;
};

type NormalizedCostItemCoverageRow = {
  id: string;
  item_type: "gift" | "supplier_fee" | "traffic";
  live_report_id: string | null;
  created_at: string;
};

type SettlementBatchCoverageRow = {
  id: string;
  batch_type: "payable" | "receivable";
  period_start: string;
  period_end: string;
};

type SettlementBatchItemCoverageRow = {
  id: string;
  settlement_batch_id: string | null;
  streamer_id: string | null;
  live_report_id: string | null;
};

type SettlementCoverageRows = {
  batches: SettlementBatchCoverageRow[];
  items: SettlementBatchItemCoverageRow[];
};

type ResolvedCoverageQueryInput = GetProjectVariableCoverageInput & {
  periodStartInclusive?: string;
  periodEndExclusive?: string;
};

type CoverageQueryResult<Row> = {
  data: Row[] | null;
  error: unknown;
  count: number | null;
};

const LIVE_REPORT_SELECT = [
  "id",
  "system_duration",
  "screenshot_duration",
  "settlement_duration",
  "evidence_level",
  "time_source",
  "viewers",
  "reviewed_at",
  "created_at",
  "live_tasks!inner(system_started_at)",
].join(", ");
const PROJECT_STREAMER_SELECT = [
  "id",
  "streamer_id",
  "hourly_rate",
  "base_salary",
  "cps_rate_bps",
  "collaboration_id",
  "joined_at",
  "removed_at",
  "streamers!inner(source_type)",
].join(", ");
const NORMALIZED_COST_ITEM_SELECT = [
  "id",
  "item_type",
  "live_report_id",
  "created_at",
].join(", ");
const SETTLEMENT_BATCH_SELECT = [
  "id",
  "batch_type",
  "period_start",
  "period_end",
].join(", ");
const SETTLEMENT_BATCH_ITEM_SELECT = [
  "id",
  "settlement_batch_id",
  "streamer_id",
  "live_report_id",
].join(", ");
const DEFAULT_MAX_ROWS_PER_SOURCE = 5_000;
const POSTGREST_PAGE_SIZE = 1_000;
const DEFAULT_TIMEZONE: ResolvedCustomRuleBusinessTimezone = {
  value: "Asia/Shanghai",
  confirmed: true,
  source: "contract_default",
};
const ALLOWED_INPUT_KEYS = new Set([
  "organizationId",
  "projectId",
  "periodStart",
  "periodEnd",
]);
const BUSINESS_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

export class SupabaseCustomRuleReadRepository
  implements CustomRuleReadRepository
{
  private readonly maxRowsPerSource: number;
  private readonly businessTimezone: ResolvedCustomRuleBusinessTimezone;

  constructor(
    private readonly client: SupabaseClient,
    options: SupabaseCustomRuleReadRepositoryOptions = {},
  ) {
    this.maxRowsPerSource = validateMaximumRows(
      options.maxRowsPerSource ?? DEFAULT_MAX_ROWS_PER_SOURCE,
    );
    this.businessTimezone = resolveBusinessTimezone(
      options.resolvedBusinessTimezone ?? DEFAULT_TIMEZONE,
    );
  }

  async getProjectVariableCoverage(
    unsafeInput: GetProjectVariableCoverageInput,
  ): Promise<ProjectVariableCoverage> {
    const input = resolveCoverageQueryInput(
      validateCoverageInput(unsafeInput),
      this.businessTimezone,
    );
    const [reports, projectStreamers, normalizedCostItems, settlement] =
      await Promise.all([
        this.listApprovedReportCoverage(input),
        this.listProjectStreamerCoverage(input),
        this.listNormalizedCostItemCoverage(input),
        this.listSettlementCoverage(input),
      ]);

    return aggregateProjectVariableCoverage({
      reports,
      projectStreamers,
      normalizedCostItems,
      settlementBatches: settlement.batches,
      settlementItems: settlement.items,
      businessTimezone: this.businessTimezone,
    });
  }

  private async listApprovedReportCoverage(
    input: ResolvedCoverageQueryInput,
  ): Promise<LiveReportCoverageRow[]> {
    return readPaginatedRows(
      "live_reports",
      this.maxRowsPerSource,
      (from, to) => {
        let query = this.client
          .from("live_reports")
          .select(LIVE_REPORT_SELECT, { count: "exact" })
          .eq("organization_id", input.organizationId)
          .eq("project_id", input.projectId)
          .eq("status", "approved");
        if (input.periodStartInclusive) {
          query = query.gte("created_at", input.periodStartInclusive);
        }
        if (input.periodEndExclusive) {
          query = query.lt("created_at", input.periodEndExclusive);
        }
        return query
          .order("id", { ascending: true })
          .range(from, to)
          .returns<LiveReportCoverageRow[]>();
      },
    );
  }

  private async listProjectStreamerCoverage(
    input: ResolvedCoverageQueryInput,
  ): Promise<ProjectStreamerCoverageRow[]> {
    return readPaginatedRows(
      "project_streamers",
      this.maxRowsPerSource,
      (from, to) => {
        let query = this.client
          .from("project_streamers")
          .select(PROJECT_STREAMER_SELECT, { count: "exact" })
          .eq("organization_id", input.organizationId)
          .eq("project_id", input.projectId)
          .not("joined_at", "is", null);
        if (input.periodEndExclusive) {
          query = query.lt("joined_at", input.periodEndExclusive);
        }
        if (input.periodStartInclusive) {
          query = query.or(
            `removed_at.is.null,removed_at.gte.${input.periodStartInclusive}`,
          );
        }
        return query
          .order("id", { ascending: true })
          .range(from, to)
          .returns<ProjectStreamerCoverageRow[]>();
      },
    );
  }

  private async listNormalizedCostItemCoverage(
    input: ResolvedCoverageQueryInput,
  ): Promise<NormalizedCostItemCoverageRow[]> {
    return readPaginatedRows(
      "project_cost_items",
      this.maxRowsPerSource,
      (from, to) => {
        let query = this.client
          .from("project_cost_items")
          .select(NORMALIZED_COST_ITEM_SELECT, { count: "exact" })
          .eq("organization_id", input.organizationId)
          .eq("project_id", input.projectId)
          .eq("source", "import")
          .eq("status", "confirmed")
          .in("item_type", ["gift", "supplier_fee", "traffic"]);
        if (input.periodStartInclusive) {
          query = query.gte("created_at", input.periodStartInclusive);
        }
        if (input.periodEndExclusive) {
          query = query.lt("created_at", input.periodEndExclusive);
        }
        return query
          .order("id", { ascending: true })
          .range(from, to)
          .returns<NormalizedCostItemCoverageRow[]>();
      },
    );
  }

  private async listSettlementCoverage(
    input: ResolvedCoverageQueryInput,
  ): Promise<SettlementCoverageRows> {
    const batches = await this.listSettlementBatchCoverage(input);
    if (batches.length === 0) {
      return { batches, items: [] };
    }
    const items = await this.listSettlementItemCoverage(
      input,
      batches.map((batch) => batch.id),
    );
    return { batches, items };
  }

  private async listSettlementBatchCoverage(
    input: ResolvedCoverageQueryInput,
  ): Promise<SettlementBatchCoverageRow[]> {
    return readPaginatedRows(
      "settlement_batches",
      this.maxRowsPerSource,
      (from, to) => {
        let query = this.client
          .from("settlement_batches")
          .select(SETTLEMENT_BATCH_SELECT, { count: "exact" })
          .eq("organization_id", input.organizationId)
          .eq("project_id", input.projectId)
          .in("batch_type", ["payable", "receivable"])
          .in("status", ["confirmed", "locked"]);
        if (input.periodStart) {
          query = query.gte("period_end", input.periodStart);
        }
        if (input.periodEnd) {
          query = query.lte("period_start", input.periodEnd);
        }
        return query
          .order("id", { ascending: true })
          .range(from, to)
          .returns<SettlementBatchCoverageRow[]>();
      },
    );
  }

  private async listSettlementItemCoverage(
    input: ResolvedCoverageQueryInput,
    unsafeBatchIds: readonly string[],
  ): Promise<SettlementBatchItemCoverageRow[]> {
    const batchIds = [...new Set(unsafeBatchIds)].sort();
    if (batchIds.length === 0) {
      return [];
    }
    return readPaginatedRows(
      "settlement_batch_items",
      this.maxRowsPerSource,
      (from, to) =>
        this.client
          .from("settlement_batch_items")
          .select(SETTLEMENT_BATCH_ITEM_SELECT, { count: "exact" })
          .eq("organization_id", input.organizationId)
          .eq("project_id", input.projectId)
          .in("settlement_batch_id", batchIds)
          .order("id", { ascending: true })
          .range(from, to)
          .returns<SettlementBatchItemCoverageRow[]>(),
    );
  }
}

async function readPaginatedRows<Row>(
  source: CoverageSource,
  limit: number,
  readPage: (
    from: number,
    to: number,
  ) => PromiseLike<CoverageQueryResult<Row>>,
): Promise<Row[]> {
  const rows: Row[] = [];
  const rowIds = new Set<string>();
  let exactCount: number | null = null;

  for (let from = 0; ; from += POSTGREST_PAGE_SIZE) {
    const result = await readPage(from, from + POSTGREST_PAGE_SIZE - 1);
    if (result.error) {
      throw new CustomRuleCoverageQueryError(source, result.error);
    }
    if (!Number.isSafeInteger(result.count) || (result.count ?? -1) < 0) {
      throw new CustomRuleCoverageCountError(
        source,
        "exact count must be a nonnegative safe integer",
      );
    }
    const pageCount = result.count as number;
    if (exactCount === null) {
      exactCount = pageCount;
      if (exactCount > limit) {
        throw new CustomRuleCoverageLimitError(source, limit);
      }
    } else if (pageCount !== exactCount) {
      throw new CustomRuleCoveragePageError(
        source,
        "exact count changed between pages",
      );
    }
    if (!Array.isArray(result.data)) {
      throw new CustomRuleCoveragePageError(
        source,
        "page rows must be an array",
      );
    }

    const expectedPageLength = Math.min(
      POSTGREST_PAGE_SIZE,
      Math.max(exactCount - from, 0),
    );
    if (result.data.length !== expectedPageLength) {
      throw new CustomRuleCoveragePageError(
        source,
        `expected ${expectedPageLength} rows at offset ${from}`,
      );
    }
    for (const row of result.data) {
      const rowId = readCoverageRowId(source, row);
      if (rowIds.has(rowId)) {
        throw new CustomRuleCoveragePageError(
          source,
          `duplicate row id at offset ${from}`,
        );
      }
      rowIds.add(rowId);
      rows.push(row);
    }

    if (rows.length === exactCount) {
      return rows;
    }
  }
}

function readCoverageRowId(source: CoverageSource, row: unknown): string {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new CustomRuleCoveragePageError(source, "page row must be an object");
  }
  const descriptor = Object.getOwnPropertyDescriptor(row, "id");
  if (
    !descriptor ||
    descriptor.get ||
    descriptor.set ||
    typeof descriptor.value !== "string" ||
    descriptor.value.length === 0
  ) {
    throw new CustomRuleCoveragePageError(
      source,
      "page row must have an own nonempty id",
    );
  }
  return descriptor.value;
}

function aggregateProjectVariableCoverage(input: {
  reports: LiveReportCoverageRow[];
  projectStreamers: ProjectStreamerCoverageRow[];
  normalizedCostItems: NormalizedCostItemCoverageRow[];
  settlementBatches: SettlementBatchCoverageRow[];
  settlementItems: SettlementBatchItemCoverageRow[];
  businessTimezone: ResolvedCustomRuleBusinessTimezone;
}): ProjectVariableCoverage {
  const reportCount = input.reports.length;
  const approvedReportIds = new Set(
    input.reports.map((row) => row.id).filter(isNonemptyString),
  );
  const projectStreamerIds = new Set(
    input.projectStreamers
      .map((row) => row.streamer_id)
      .filter(isNonemptyString),
  );
  const streamerCount = projectStreamerIds.size;
  const reportPeriod = sampledPeriod(
    input.reports.map((row) => row.created_at),
  );
  const streamerPeriod = sampledPeriod(
    input.projectStreamers.flatMap((row) =>
      [row.joined_at, row.removed_at].filter(isString),
    ),
  );
  const liveStartedCount = countPresent(input.reports, (row) =>
    firstRelation(row.live_tasks)?.system_started_at,
  );
  const normalizedByType = (itemType: NormalizedCostItemCoverageRow["item_type"]) =>
    input.normalizedCostItems.filter((row) => row.item_type === itemType);
  const giftItems = normalizedByType("gift");
  const supplierItems = normalizedByType("supplier_fee");
  const trafficItems = normalizedByType("traffic");
  const settlementBatchesById = new Map(
    input.settlementBatches.map((batch) => [batch.id, batch]),
  );
  const settlementRows = input.settlementItems
    .filter(
      (row) =>
        row.live_report_id !== null &&
        approvedReportIds.has(row.live_report_id) &&
        row.streamer_id !== null &&
        projectStreamerIds.has(row.streamer_id),
    )
    .flatMap((row) => {
      const batch = row.settlement_batch_id
        ? settlementBatchesById.get(row.settlement_batch_id)
        : undefined;
      return batch ? [{ row, batch }] : [];
    });
  const payableItems = settlementRows.filter(
    ({ batch }) => batch.batch_type === "payable",
  );
  const receivableItems = settlementRows.filter(
    ({ batch }) => batch.batch_type === "receivable",
  );
  const periodPresence = reportCount > 0 ? 1 : 0;

  const variables: Record<string, CustomRuleVariableCoverage> = {
    system_minutes: coverage(
      "system_minutes",
      countPresent(input.reports, (row) => row.system_duration),
      reportCount,
      reportPeriod,
    ),
    screenshot_minutes: coverage(
      "screenshot_minutes",
      countPresent(input.reports, (row) => row.screenshot_duration),
      reportCount,
      reportPeriod,
    ),
    settlement_minutes: coverage(
      "settlement_minutes",
      countPresent(input.reports, (row) => row.settlement_duration),
      reportCount,
      reportPeriod,
    ),
    evidence_level: coverage(
      "evidence_level",
      countPresent(input.reports, (row) => row.evidence_level),
      reportCount,
      reportPeriod,
    ),
    time_source: coverage(
      "time_source",
      countPresent(input.reports, (row) => row.time_source),
      reportCount,
      reportPeriod,
    ),
    views: coverage(
      "views",
      countPresent(input.reports, (row) => row.viewers),
      reportCount,
      reportPeriod,
    ),
    live_started_at: coverage(
      "live_started_at",
      liveStartedCount,
      reportCount,
      reportPeriod,
    ),
    weekday: coverage(
      "weekday",
      liveStartedCount,
      reportCount,
      reportPeriod,
    ),
    hour_of_day: coverage(
      "hour_of_day",
      liveStartedCount,
      reportCount,
      reportPeriod,
    ),
    approved_at: coverage(
      "approved_at",
      countPresent(input.reports, (row) => row.reviewed_at),
      reportCount,
      reportPeriod,
    ),
    project_id: coverage("project_id", 1, 1, reportPeriod),
    project_tags: coverage("project_tags", 0, 1, null),
    streamer_id: coverage(
      "streamer_id",
      streamerCount,
      streamerCount,
      streamerPeriod,
    ),
    streamer_level: coverage(
      "streamer_level",
      0,
      streamerCount,
      null,
    ),
    streamer_source: coverage(
      "streamer_source",
      countPresent(input.projectStreamers, (row) =>
        firstRelation(row.streamers)?.source_type,
      ),
      streamerCount,
      streamerPeriod,
    ),
    collaboration_id: coverage(
      "collaboration_id",
      countPresent(input.projectStreamers, (row) => row.collaboration_id),
      streamerCount,
      streamerPeriod,
    ),
    base_hourly_rate: coverage(
      "base_hourly_rate",
      countPresent(input.projectStreamers, (row) => row.hourly_rate),
      streamerCount,
      streamerPeriod,
    ),
    base_salary: coverage(
      "base_salary",
      countPresent(input.projectStreamers, (row) => row.base_salary),
      streamerCount,
      streamerPeriod,
    ),
    cps_rate: coverage(
      "cps_rate",
      countPresent(input.projectStreamers, (row) => row.cps_rate_bps),
      streamerCount,
      streamerPeriod,
    ),
    streamer_group_ids: coverage(
      "streamer_group_ids",
      0,
      streamerCount,
      null,
    ),
    sales_amount: coverage("sales_amount", 0, reportCount, null),
    orders_count: coverage("orders_count", 0, reportCount, null),
    gift_amount: normalizedCoverage(
      "gift_amount",
      giftItems,
      reportCount,
      approvedReportIds,
    ),
    supplier_fee: normalizedCoverage(
      "supplier_fee",
      supplierItems,
      reportCount,
      approvedReportIds,
    ),
    traffic_cost: normalizedCoverage(
      "traffic_cost",
      trafficItems,
      reportCount,
      approvedReportIds,
    ),
    manual_adjustment: coverage(
      "manual_adjustment",
      0,
      reportCount,
      null,
    ),
    period_system_minutes: coverage(
      "period_system_minutes",
      countPresent(input.reports, (row) => row.system_duration),
      reportCount,
      reportPeriod,
    ),
    period_settlement_minutes: coverage(
      "period_settlement_minutes",
      countPresent(input.reports, (row) => row.settlement_duration),
      reportCount,
      reportPeriod,
    ),
    period_sales_amount: coverage(
      "period_sales_amount",
      0,
      reportCount,
      null,
    ),
    period_orders_count: coverage(
      "period_orders_count",
      0,
      reportCount,
      null,
    ),
    period_report_count: coverage(
      "period_report_count",
      periodPresence,
      periodPresence,
      reportPeriod,
    ),
    red_evidence_count: coverage(
      "red_evidence_count",
      countPresent(input.reports, (row) => row.evidence_level),
      reportCount,
      reportPeriod,
    ),
    yellow_evidence_count: coverage(
      "yellow_evidence_count",
      countPresent(input.reports, (row) => row.evidence_level),
      reportCount,
      reportPeriod,
    ),
    period_payable_amount: coverage(
      "period_payable_amount",
      uniqueNonNullCount(payableItems.map(({ row }) => row.streamer_id)),
      streamerCount,
      settlementPeriod(payableItems.map(({ batch }) => batch)),
    ),
    period_receivable_amount: coverage(
      "period_receivable_amount",
      uniqueNonNullCount(
        receivableItems.map(({ row }) => row.live_report_id),
      ),
      reportCount,
      settlementPeriod(receivableItems.map(({ batch }) => batch)),
    ),
    period_start: coverage(
      "period_start",
      periodPresence,
      periodPresence,
      reportPeriod,
    ),
    period_end: coverage(
      "period_end",
      periodPresence,
      periodPresence,
      reportPeriod,
    ),
  };

  return {
    hasHistory: reportCount > 0,
    businessTimezone: input.businessTimezone.value,
    businessTimezoneConfirmed: input.businessTimezone.confirmed,
    businessTimezoneSource: input.businessTimezone.source,
    variables,
  };
}

function normalizedCoverage(
  variableId: string,
  rows: NormalizedCostItemCoverageRow[],
  denominator: number,
  approvedReportIds: ReadonlySet<string>,
): CustomRuleVariableCoverage {
  const approvedRows = rows.filter(
    (row) =>
      row.live_report_id !== null &&
      approvedReportIds.has(row.live_report_id),
  );
  return coverage(
    variableId,
    uniqueNonNullCount(approvedRows.map((row) => row.live_report_id)),
    denominator,
    sampledPeriod(approvedRows.map((row) => row.created_at)),
  );
}

function coverage(
  variableId: string,
  numerator: number,
  denominator: number,
  latestSampledPeriod: CustomRuleLatestSampledPeriod | null,
): CustomRuleVariableCoverage {
  assertCoverageCounts(variableId, numerator, denominator);
  return { numerator, denominator, latestSampledPeriod };
}

function countPresent<Row>(
  rows: readonly Row[],
  select: (row: Row) => unknown,
): number {
  return rows.reduce((count, row) => {
    const value = select(row);
    return value === null || value === undefined ? count : count + 1;
  }, 0);
}

function uniqueNonNullCount(values: ReadonlyArray<string | null>): number {
  const unique = new Set(
    values.filter((value): value is string => Boolean(value)),
  );
  return unique.size;
}

function firstRelation<Row>(row: Row | Row[] | null): Row | null {
  if (Array.isArray(row)) {
    return row[0] ?? null;
  }
  return row;
}

function sampledPeriod(
  values: readonly string[],
): CustomRuleLatestSampledPeriod | null {
  const ordered = values
    .filter((value) => Number.isFinite(Date.parse(value)))
    .map((value) => ({ value, timestamp: Date.parse(value) }))
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp ||
        left.value.localeCompare(right.value),
    );
  if (ordered.length === 0) {
    return null;
  }
  return {
    start: ordered[0].value,
    end: ordered[ordered.length - 1].value,
  };
}

function settlementPeriod(
  batches: ReadonlyArray<{
    period_start: string;
    period_end: string;
  }>,
): CustomRuleLatestSampledPeriod | null {
  const starts = sampledPeriod(batches.map((batch) => batch.period_start));
  const ends = sampledPeriod(batches.map((batch) => batch.period_end));
  return starts && ends ? { start: starts.start, end: ends.end } : null;
}

function validateCoverageInput(
  input: unknown,
): GetProjectVariableCoverageInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CustomRuleCoverageInputError("input must be an own-data object");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CustomRuleCoverageInputError(
      "input must not inherit organization or project data",
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(input);
  if (
    keys.some(
      (key) => typeof key !== "string" || !ALLOWED_INPUT_KEYS.has(key),
    )
  ) {
    throw new CustomRuleCoverageInputError("input contains an unknown key");
  }
  for (const descriptor of Object.values(descriptors)) {
    if (descriptor.get || descriptor.set || !("value" in descriptor)) {
      throw new CustomRuleCoverageInputError(
        "input properties must be own data properties",
      );
    }
  }

  const organizationId = nonemptyOwnString(
    descriptors,
    "organizationId",
  );
  const projectId = nonemptyOwnString(descriptors, "projectId");
  const periodStart = optionalPeriod(descriptors, "periodStart");
  const periodEnd = optionalPeriod(descriptors, "periodEnd");
  if (
    periodStart &&
    periodEnd &&
    periodStart > periodEnd
  ) {
    throw new CustomRuleCoverageInputError(
      "periodStart must not be later than periodEnd",
    );
  }

  return {
    organizationId,
    projectId,
    ...(periodStart ? { periodStart } : {}),
    ...(periodEnd ? { periodEnd } : {}),
  };
}

function nonemptyOwnString(
  descriptors: PropertyDescriptorMap,
  key: "organizationId" | "projectId",
): string {
  const value = descriptors[key]?.value;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CustomRuleCoverageInputError(`${key} must be a nonempty string`);
  }
  return value.trim();
}

function optionalPeriod(
  descriptors: PropertyDescriptorMap,
  key: "periodStart" | "periodEnd",
): string | undefined {
  const value = descriptors[key]?.value;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !isValidBusinessDate(value)) {
    throw new CustomRuleCoverageInputError(
      `${key} must be a valid YYYY-MM-DD business date`,
    );
  }
  return value;
}

function resolveCoverageQueryInput(
  input: GetProjectVariableCoverageInput,
  businessTimezone: ResolvedCustomRuleBusinessTimezone,
): ResolvedCoverageQueryInput {
  if (!input.periodStart && !input.periodEnd) {
    return input;
  }
  if (!businessTimezone.confirmed || !businessTimezone.value) {
    throw new CustomRuleCoverageInputError(
      "period filtering requires a confirmed IANA business timezone",
    );
  }

  return {
    ...input,
    ...(input.periodStart
      ? {
          periodStartInclusive: businessDateBoundary(
            input.periodStart,
            businessTimezone.value,
          ),
        }
      : {}),
    ...(input.periodEnd
      ? {
          periodEndExclusive: businessDateBoundary(
            nextBusinessDate(input.periodEnd),
            businessTimezone.value,
          ),
        }
      : {}),
  };
}

type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

type CalendarDateTimeParts = CalendarDateParts & {
  hour: number;
  minute: number;
  second: number;
};

function isValidBusinessDate(value: string): boolean {
  const parts = parseBusinessDate(value);
  return (
    parts !== null &&
    parts.year >= 1 &&
    parts.day <= daysInMonth(parts.year, parts.month)
  );
}

function parseBusinessDate(value: string): CalendarDateParts | null {
  const match = BUSINESS_DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return null;
  }
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function nextBusinessDate(value: string): string {
  const parsed = parseBusinessDate(value);
  if (!parsed || !isValidBusinessDate(value)) {
    throw new CustomRuleCoverageInputError("invalid business-date boundary");
  }
  let { year, month, day } = parsed;
  day += 1;
  if (day > daysInMonth(year, month)) {
    day = 1;
    month += 1;
  }
  if (month > 12) {
    month = 1;
    year += 1;
  }
  if (year > 9_999) {
    throw new CustomRuleCoverageInputError(
      "periodEnd cannot produce a supported exclusive boundary",
    );
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function businessDateBoundary(value: string, timezone: string): string {
  const parsed = parseBusinessDate(value);
  if (!parsed || !isValidBusinessDate(value)) {
    throw new CustomRuleCoverageInputError("invalid business-date boundary");
  }
  const targetEpoch = utcEpoch({ ...parsed, hour: 0, minute: 0, second: 0 });
  let instant = targetEpoch;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const local = zonedDateTimeParts(instant, timezone);
    const adjustment = targetEpoch - utcEpoch(local);
    instant += adjustment;
    if (adjustment === 0) {
      break;
    }
  }

  const local = zonedDateTimeParts(instant, timezone);
  if (
    local.year !== parsed.year ||
    local.month !== parsed.month ||
    local.day !== parsed.day ||
    local.hour !== 0 ||
    local.minute !== 0 ||
    local.second !== 0
  ) {
    throw new CustomRuleCoverageInputError(
      "business-date midnight does not exist in the resolved timezone",
    );
  }
  const offsetMinutes = (targetEpoch - instant) / 60_000;
  if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 24 * 60) {
    throw new CustomRuleCoverageInputError(
      "business timezone produced an unsupported UTC offset",
    );
  }
  return `${value}T00:00:00.000${formatOffset(offsetMinutes)}`;
}

function zonedDateTimeParts(
  epochMilliseconds: number,
  timezone: string,
): CalendarDateTimeParts {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    throw new CustomRuleCoverageInputError(
      "business timezone cannot resolve period boundaries",
    );
  }

  const values = new Map<string, number>();
  for (const part of formatter.formatToParts(new Date(epochMilliseconds))) {
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day" ||
      part.type === "hour" ||
      part.type === "minute" ||
      part.type === "second"
    ) {
      values.set(part.type, Number(part.value));
    }
  }
  const result = {
    year: values.get("year"),
    month: values.get("month"),
    day: values.get("day"),
    hour: values.get("hour"),
    minute: values.get("minute"),
    second: values.get("second"),
  };
  if (Object.values(result).some((part) => !Number.isInteger(part))) {
    throw new CustomRuleCoverageInputError(
      "business timezone returned an invalid calendar boundary",
    );
  }
  return result as CalendarDateTimeParts;
}

function utcEpoch(parts: CalendarDateTimeParts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function validateMaximumRows(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CustomRuleCoverageInputError(
      "maxRowsPerSource must be a positive safe integer",
    );
  }
  return value;
}

function resolveBusinessTimezone(
  timezone: ResolvedCustomRuleBusinessTimezone,
): ResolvedCustomRuleBusinessTimezone {
  const source = normalizeCustomRuleBusinessTimezoneSource(timezone.source);
  return {
    value: timezone.value,
    source,
    confirmed: isConfirmedIanaTimezone({
      businessTimezone: timezone.value,
      businessTimezoneConfirmed: timezone.confirmed,
      businessTimezoneSource: source,
    }),
  };
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}

function isNonemptyString(value: string): boolean {
  return value.length > 0;
}
