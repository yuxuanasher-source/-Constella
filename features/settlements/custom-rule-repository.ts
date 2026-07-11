import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assertCoverageCounts,
  type CustomRuleBusinessTimezoneSource,
  type CustomRuleLatestSampledPeriod,
  type CustomRuleVariableCoverage,
  type ProjectVariableCoverage,
} from "./custom-rule-variable-catalog";

export type GetProjectVariableCoverageInput = {
  organizationId: string;
  projectId: string;
  periodStart?: string;
  periodEnd?: string;
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

type CoverageSource =
  | "live_reports"
  | "project_streamers"
  | "project_cost_items"
  | "settlement_batch_items";

type LiveTaskRelation =
  | { system_started_at: string | null }
  | Array<{ system_started_at: string | null }>
  | null;

type LiveReportCoverageRow = {
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
  hourly_rate: number | null;
  base_salary: number | null;
  cps_rate_bps: number | null;
  collaboration_id: string | null;
  joined_at: string | null;
  removed_at: string | null;
  streamers: StreamerRelation;
};

type NormalizedCostItemCoverageRow = {
  item_type: "gift" | "supplier_fee" | "traffic";
  live_report_id: string | null;
  created_at: string;
};

type SettlementBatchRelation =
  | {
      batch_type: "payable" | "receivable";
      period_start: string;
      period_end: string;
    }
  | Array<{
      batch_type: "payable" | "receivable";
      period_start: string;
      period_end: string;
    }>
  | null;

type SettlementBatchItemCoverageRow = {
  streamer_id: string | null;
  live_report_id: string | null;
  created_at: string;
  settlement_batches: SettlementBatchRelation;
};

type CoverageQueryResult<Row> = {
  data: Row[] | null;
  error: unknown;
  count: number | null;
};

const LIVE_REPORT_SELECT = [
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
  "hourly_rate",
  "base_salary",
  "cps_rate_bps",
  "collaboration_id",
  "joined_at",
  "removed_at",
  "streamers!inner(source_type)",
].join(", ");
const NORMALIZED_COST_ITEM_SELECT = [
  "item_type",
  "live_report_id",
  "created_at",
].join(", ");
const SETTLEMENT_BATCH_ITEM_SELECT = [
  "streamer_id",
  "live_report_id",
  "created_at",
  "settlement_batches!inner(batch_type, period_start, period_end)",
].join(", ");
const DEFAULT_MAX_ROWS_PER_SOURCE = 5_000;
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
const ISO_PERIOD_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/u;

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
    const input = validateCoverageInput(unsafeInput);
    const [reports, projectStreamers, normalizedCostItems, settlementItems] =
      await Promise.all([
        this.listApprovedReportCoverage(input),
        this.listProjectStreamerCoverage(input),
        this.listNormalizedCostItemCoverage(input),
        this.listSettlementItemCoverage(input),
      ]);

    return aggregateProjectVariableCoverage({
      reports,
      projectStreamers,
      normalizedCostItems,
      settlementItems,
      businessTimezone: this.businessTimezone,
    });
  }

  private async listApprovedReportCoverage(
    input: GetProjectVariableCoverageInput,
  ): Promise<LiveReportCoverageRow[]> {
    let query = this.client
      .from("live_reports")
      .select(LIVE_REPORT_SELECT, { count: "exact" })
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .eq("status", "approved");
    if (input.periodStart) {
      query = query.gte("created_at", input.periodStart);
    }
    if (input.periodEnd) {
      query = query.lte("created_at", input.periodEnd);
    }

    return readBoundedRows(
      "live_reports",
      query
        .limit(this.maxRowsPerSource + 1)
        .returns<LiveReportCoverageRow[]>(),
      this.maxRowsPerSource,
    );
  }

  private async listProjectStreamerCoverage(
    input: GetProjectVariableCoverageInput,
  ): Promise<ProjectStreamerCoverageRow[]> {
    let query = this.client
      .from("project_streamers")
      .select(PROJECT_STREAMER_SELECT, { count: "exact" })
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .not("joined_at", "is", null);
    if (input.periodEnd) {
      query = query.lte("joined_at", input.periodEnd);
    }
    if (input.periodStart) {
      query = query.or(
        `removed_at.is.null,removed_at.gte.${input.periodStart}`,
      );
    }

    return readBoundedRows(
      "project_streamers",
      query
        .limit(this.maxRowsPerSource + 1)
        .returns<ProjectStreamerCoverageRow[]>(),
      this.maxRowsPerSource,
    );
  }

  private async listNormalizedCostItemCoverage(
    input: GetProjectVariableCoverageInput,
  ): Promise<NormalizedCostItemCoverageRow[]> {
    let query = this.client
      .from("project_cost_items")
      .select(NORMALIZED_COST_ITEM_SELECT, { count: "exact" })
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .eq("source", "import")
      .eq("status", "confirmed")
      .in("item_type", ["gift", "supplier_fee", "traffic"]);
    if (input.periodStart) {
      query = query.gte("created_at", input.periodStart);
    }
    if (input.periodEnd) {
      query = query.lte("created_at", input.periodEnd);
    }

    return readBoundedRows(
      "project_cost_items",
      query
        .limit(this.maxRowsPerSource + 1)
        .returns<NormalizedCostItemCoverageRow[]>(),
      this.maxRowsPerSource,
    );
  }

  private async listSettlementItemCoverage(
    input: GetProjectVariableCoverageInput,
  ): Promise<SettlementBatchItemCoverageRow[]> {
    let query = this.client
      .from("settlement_batch_items")
      .select(SETTLEMENT_BATCH_ITEM_SELECT, { count: "exact" })
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .in("settlement_batches.batch_type", ["payable", "receivable"]);
    if (input.periodStart) {
      query = query.gte("created_at", input.periodStart);
    }
    if (input.periodEnd) {
      query = query.lte("created_at", input.periodEnd);
    }

    return readBoundedRows(
      "settlement_batch_items",
      query
        .limit(this.maxRowsPerSource + 1)
        .returns<SettlementBatchItemCoverageRow[]>(),
      this.maxRowsPerSource,
    );
  }
}

async function readBoundedRows<Row>(
  source: CoverageSource,
  pending: PromiseLike<CoverageQueryResult<Row>>,
  limit: number,
): Promise<Row[]> {
  const result = await pending;
  if (result.error) {
    throw new CustomRuleCoverageQueryError(source, result.error);
  }
  if (!Number.isSafeInteger(result.count) || (result.count ?? -1) < 0) {
    throw new CustomRuleCoverageCountError(
      source,
      "exact count must be a nonnegative safe integer",
    );
  }
  const exactCount = result.count as number;
  if (exactCount > limit) {
    throw new CustomRuleCoverageLimitError(source, limit);
  }
  if (!Array.isArray(result.data)) {
    if (exactCount === 0 && result.data === null) {
      return [];
    }
    throw new CustomRuleCoverageCountError(
      source,
      "rows were not returned for the exact count",
    );
  }
  if (result.data.length !== exactCount) {
    throw new CustomRuleCoverageCountError(
      source,
      "bounded rows do not match the exact count",
    );
  }

  return result.data;
}

function aggregateProjectVariableCoverage(input: {
  reports: LiveReportCoverageRow[];
  projectStreamers: ProjectStreamerCoverageRow[];
  normalizedCostItems: NormalizedCostItemCoverageRow[];
  settlementItems: SettlementBatchItemCoverageRow[];
  businessTimezone: ResolvedCustomRuleBusinessTimezone;
}): ProjectVariableCoverage {
  const reportCount = input.reports.length;
  const streamerCount = input.projectStreamers.length;
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
  const settlementRows = input.settlementItems.flatMap((row) =>
    relationRows(row.settlement_batches).map((batch) => ({ row, batch })),
  );
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
    gift_amount: normalizedCoverage("gift_amount", giftItems, reportCount),
    supplier_fee: normalizedCoverage(
      "supplier_fee",
      supplierItems,
      reportCount,
    ),
    traffic_cost: normalizedCoverage(
      "traffic_cost",
      trafficItems,
      reportCount,
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
      boundedUniqueCount(
        payableItems.map(({ row }) => row.streamer_id),
        streamerCount,
      ),
      streamerCount,
      settlementPeriod(payableItems.map(({ batch }) => batch)),
    ),
    period_receivable_amount: coverage(
      "period_receivable_amount",
      boundedUniqueCount(
        receivableItems.map(({ row }) => row.live_report_id),
        reportCount,
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
): CustomRuleVariableCoverage {
  return coverage(
    variableId,
    boundedUniqueCount(
      rows.map((row) => row.live_report_id),
      denominator,
    ),
    denominator,
    sampledPeriod(rows.map((row) => row.created_at)),
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

function boundedUniqueCount(
  values: ReadonlyArray<string | null>,
  denominator: number,
): number {
  const unique = new Set(
    values.filter((value): value is string => Boolean(value)),
  );
  return Math.min(unique.size, denominator);
}

function firstRelation<Row>(row: Row | Row[] | null): Row | null {
  if (Array.isArray(row)) {
    return row[0] ?? null;
  }
  return row;
}

function relationRows<Row>(row: Row | Row[] | null): Row[] {
  if (Array.isArray(row)) {
    return row;
  }
  return row ? [row] : [];
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
    Date.parse(periodStart) > Date.parse(periodEnd)
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
  if (
    typeof value !== "string" ||
    !ISO_PERIOD_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new CustomRuleCoverageInputError(
      `${key} must be an ISO date or timestamp`,
    );
  }
  return value;
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
  return {
    value: timezone.value,
    source: timezone.source,
    confirmed:
      timezone.confirmed &&
      typeof timezone.value === "string" &&
      isValidIanaTimezone(timezone.value),
  };
}

function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}
