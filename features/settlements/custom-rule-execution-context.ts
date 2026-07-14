import {
  assertSafeIntegerValue,
  yuanToCentsStrict,
  type CustomRuleScope,
  type TypedRuntimeValue,
} from "./custom-rule-types";

export type CustomRuleReportContextInput = Readonly<{
  businessTimezone: string;
  businessTimezoneConfirmed: boolean;
  report: Readonly<{
    id: string;
    projectId: string;
    streamerId?: string;
    systemDurationMinutes?: number | null;
    screenshotDurationMinutes?: number | null;
    settlementDurationMinutes?: number | null;
    viewers?: number | null;
    evidenceLevel?: string | null;
    timeSource?: string | null;
    liveStartedAt?: string | null;
    approvedAt?: string | null;
  }>;
  projectStreamer: Readonly<{
    id: string;
    streamerId: string;
    streamerSource?: string | null;
    collaborationId?: string | null;
    hourlyRateYuan?: number | null;
    baseSalaryYuan?: number | null;
    cpsRateBps?: number | null;
  }> | null;
}>;

export type CustomRulePeriodAggregateInput = Readonly<{
  scope: CustomRuleScope;
  projectId: string;
  periodStart: string;
  periodEnd: string;
  approvedReports: readonly Readonly<{
    id: string;
    approved: boolean;
    systemDurationMinutes?: number | null;
    settlementDurationMinutes?: number | null;
    salesAmountCents?: number | null;
    ordersCount?: number | null;
    evidenceLevel?: string | null;
  }>[];
}>;

export function buildCustomRuleReportExecutionContext(
  input: CustomRuleReportContextInput,
): {
  variables: Record<string, TypedRuntimeValue>;
  sourceSnapshot: Record<string, unknown>;
} {
  assertConfirmedTimezone(input.businessTimezone, input.businessTimezoneConfirmed);

  const variables: Record<string, TypedRuntimeValue> = {
    project_id: { type: "string", value: input.report.projectId },
  };
  addString(variables, "streamer_id", input.report.streamerId);
  addInteger(variables, "system_minutes", input.report.systemDurationMinutes);
  addInteger(
    variables,
    "screenshot_minutes",
    input.report.screenshotDurationMinutes,
  );
  addInteger(
    variables,
    "settlement_minutes",
    input.report.settlementDurationMinutes,
  );
  addInteger(variables, "views", input.report.viewers);
  addString(variables, "evidence_level", input.report.evidenceLevel);
  addString(variables, "time_source", input.report.timeSource);
  if (input.report.approvedAt) {
    variables.approved_at = {
      type: "timestamp",
      value: new Date(input.report.approvedAt).toISOString(),
    };
  }
  if (input.report.liveStartedAt) {
    const liveStartedAt = new Date(input.report.liveStartedAt).toISOString();
    variables.live_started_at = { type: "timestamp", value: liveStartedAt };
    const local = weekdayAndHour(liveStartedAt, input.businessTimezone);
    variables.weekday = { type: "integer", value: local.weekday };
    variables.hour_of_day = { type: "integer", value: local.hour };
  }

  const projectStreamer = input.projectStreamer;
  if (projectStreamer) {
    addString(variables, "streamer_source", projectStreamer.streamerSource);
    addString(variables, "collaboration_id", projectStreamer.collaborationId);
    if (projectStreamer.hourlyRateYuan !== null && projectStreamer.hourlyRateYuan !== undefined) {
      variables.base_hourly_rate = {
        type: "money_cents",
        amountCents: yuanToCentsStrict(projectStreamer.hourlyRateYuan),
      };
    }
    if (projectStreamer.baseSalaryYuan !== null && projectStreamer.baseSalaryYuan !== undefined) {
      variables.base_salary = {
        type: "money_cents",
        amountCents: yuanToCentsStrict(projectStreamer.baseSalaryYuan),
      };
    }
    if (projectStreamer.cpsRateBps !== null && projectStreamer.cpsRateBps !== undefined) {
      variables.cps_rate = {
        type: "rate_bps",
        rateBps: assertSafeIntegerValue(projectStreamer.cpsRateBps, "cps_rate"),
      };
    }
  }

  return {
    variables,
    sourceSnapshot: {
      reportId: input.report.id,
      projectStreamerId: projectStreamer?.id ?? null,
      businessTimezone: input.businessTimezone,
    },
  };
}

export function buildCustomRulePeriodAggregates(
  input: CustomRulePeriodAggregateInput,
): {
  variables: Record<string, TypedRuntimeValue>;
  sourceReportIds: string[];
} {
  const reports = input.approvedReports
    .filter((report) => report.approved)
    .sort((left, right) => left.id.localeCompare(right.id));
  const variables: Record<string, TypedRuntimeValue> = {
    project_id: { type: "string", value: input.projectId },
    period_start: { type: "timestamp", value: input.periodStart },
    period_end: { type: "timestamp", value: input.periodEnd },
    period_report_count: { type: "integer", value: reports.length },
  };
  addSum(variables, "period_system_minutes", reports.map((report) => report.systemDurationMinutes), "integer");
  addSum(
    variables,
    "period_settlement_minutes",
    reports.map((report) => report.settlementDurationMinutes),
    "integer",
  );
  addSum(
    variables,
    "period_sales_amount",
    reports.map((report) => report.salesAmountCents),
    "money_cents",
  );
  addSum(
    variables,
    "period_orders_count",
    reports.map((report) => report.ordersCount),
    "integer",
  );
  if (reports.every((report) => report.evidenceLevel !== null && report.evidenceLevel !== undefined)) {
    variables.red_evidence_count = {
      type: "integer",
      value: reports.filter((report) => report.evidenceLevel === "red").length,
    };
    variables.yellow_evidence_count = {
      type: "integer",
      value: reports.filter((report) => report.evidenceLevel === "yellow").length,
    };
  }
  return {
    variables,
    sourceReportIds: reports.map((report) => report.id),
  };
}

function addInteger(
  variables: Record<string, TypedRuntimeValue>,
  name: string,
  value: number | null | undefined,
): void {
  if (value === null || value === undefined) return;
  variables[name] = {
    type: "integer",
    value: assertSafeIntegerValue(value, name),
  };
}

function addString(
  variables: Record<string, TypedRuntimeValue>,
  name: string,
  value: string | null | undefined,
): void {
  if (value === null || value === undefined) return;
  variables[name] = { type: "string", value };
}

function addSum(
  variables: Record<string, TypedRuntimeValue>,
  name: string,
  values: Array<number | null | undefined>,
  type: "integer" | "money_cents",
): void {
  if (values.some((value) => value === null || value === undefined)) return;
  let total = 0;
  for (const value of values) {
    if (value === null || value === undefined) return;
    const safeValue = assertSafeIntegerValue(value, name);
    total = assertSafeIntegerValue(total + safeValue, name);
  }
  variables[name] =
    type === "integer"
      ? { type: "integer", value: total }
      : { type: "money_cents", amountCents: total };
}

function assertConfirmedTimezone(timezone: string, confirmed: boolean): void {
  if (!confirmed) {
    throw new Error("weekday/hour require a confirmed IANA business timezone");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw new Error("weekday/hour require a confirmed IANA business timezone");
  }
}

function weekdayAndHour(
  timestamp: string,
  timezone: string,
): { weekday: number; hour: number } {
  const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(timestamp));
  const weekdayText = parts.find((part) => part.type === "weekday")?.value;
  const hourText = parts.find((part) => part.type === "hour")?.value;
  const weekdays: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const weekday = weekdayText ? weekdays[weekdayText] : undefined;
  const hour = hourText ? Number(hourText) % 24 : Number.NaN;
  if (!weekday || !Number.isSafeInteger(hour)) {
    throw new Error("weekday/hour require a confirmed IANA business timezone");
  }
  return { weekday, hour };
}
