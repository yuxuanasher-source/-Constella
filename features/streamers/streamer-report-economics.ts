export type MaybeRelation<T> = T | T[] | null | undefined;

export type SettlementItemEvidence = {
  id: string;
  streamer_id?: string | null;
  live_report_id?: string | null;
  computed_amount: unknown;
  manual_amount: unknown;
  adjustment_amount: unknown;
  settlement_batches?: MaybeRelation<{
    organization_id?: string | null;
    batch_type: string;
    status: string;
  }>;
};

export type SettlementItemReportLinkEvidence = {
  settlement_batch_item_id?: string | null;
  settlement_batch_items?: MaybeRelation<SettlementItemEvidence>;
};

export type StreamerMetricEvidence = {
  source_report_id: string | null;
  metric_key: string;
  metric_value: unknown;
};

export type ReportEconomicsEvidence = {
  id?: string | null;
  live_task_id?: string | null;
  status: string;
  created_at?: string | null;
  settlement_duration?: number | null;
  viewers?: number | null;
  settlement_batch_items?: SettlementItemEvidence[];
  settlement_batch_item_reports?: SettlementItemReportLinkEvidence[];
  streamer_metrics?: StreamerMetricEvidence[];
};

export type SettlementItemAmount = {
  id: string;
  amount: number;
};

export type AuthoritativeReportEconomics<T extends ReportEconomicsEvidence> = {
  authoritativeReports: T[];
  settlementItems: SettlementItemAmount[] | null;
  totalSettlementAmount: number | null;
  avgSessionMinutes: number | null;
  actualHourlyRate: number | null;
  totalGmvAmount: number | null;
  roiBps: number | null;
  roi: number | null;
  viewsPerHour: number | null;
};

export function selectAuthoritativeApprovedReports<
  T extends ReportEconomicsEvidence,
>(reports: T[]): T[] {
  const selectedByTask = new Map<
    string,
    { report: T; originalIndex: number }
  >();

  reports.forEach((report, originalIndex) => {
    if (report.status !== "approved") return;
    const taskKey =
      nonEmptyString(report.live_task_id) ??
      `report:${nonEmptyString(report.id) ?? originalIndex}`;
    const current = selectedByTask.get(taskKey);
    if (
      !current ||
      compareReportAuthority(report, current.report) > 0
    ) {
      selectedByTask.set(taskKey, { report, originalIndex });
    }
  });

  return Array.from(selectedByTask.values())
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .map(({ report }) => report);
}

export function readReportSettlementItems(
  report: ReportEconomicsEvidence,
  expectedOrganizationId?: string,
  expectedStreamerId?: string,
): SettlementItemAmount[] | null {
  const uniqueItems = new Map<string, SettlementItemEvidence>();
  for (const item of report.settlement_batch_items ?? []) {
    if (!item?.id) continue;
    if (
      !hasReliableItemOwnership(
        item,
        report,
        expectedStreamerId,
        "direct",
      )
    ) {
      return null;
    }
    uniqueItems.set(item.id, item);
  }
  for (const link of report.settlement_batch_item_reports ?? []) {
    const item = first(link.settlement_batch_items);
    if (!item?.id) continue;
    if (
      !hasReliableItemOwnership(
        item,
        report,
        expectedStreamerId,
        "junction",
      )
    ) {
      return null;
    }
    uniqueItems.set(item.id, item);
  }

  const amounts: SettlementItemAmount[] = [];
  for (const item of uniqueItems.values()) {
    const batch = first(item.settlement_batches);
    if (
      batch?.batch_type !== "payable" ||
      (batch.status !== "confirmed" && batch.status !== "locked")
    ) {
      continue;
    }
    if (
      expectedOrganizationId &&
      batch.organization_id !== expectedOrganizationId
    ) {
      return null;
    }
    const computedAmount = finiteNumber(item.computed_amount);
    const manualAmount = finiteNumber(item.manual_amount);
    const adjustmentAmount = finiteNumber(item.adjustment_amount);
    if (
      computedAmount === null ||
      manualAmount === null ||
      adjustmentAmount === null
    ) {
      return null;
    }
    amounts.push({
      id: item.id,
      amount: roundAmount(
        computedAmount + manualAmount + adjustmentAmount,
      ),
    });
  }

  return amounts.length > 0 ? amounts : null;
}

export function aggregateUniqueSettlementItems(
  groups: Array<SettlementItemAmount[] | null>,
): SettlementItemAmount[] | null {
  if (groups.length === 0 || groups.some((group) => group === null)) {
    return null;
  }
  const uniqueItems = new Map<string, SettlementItemAmount>();
  for (const group of groups) {
    for (const item of group ?? []) {
      uniqueItems.set(item.id, item);
    }
  }
  return uniqueItems.size > 0 ? Array.from(uniqueItems.values()) : null;
}

export function deriveAuthoritativeReportEconomics<
  T extends ReportEconomicsEvidence,
>(
  reports: T[],
  expectedOrganizationId?: string,
  expectedStreamerId?: string,
): AuthoritativeReportEconomics<T> {
  const authoritativeReports = selectAuthoritativeApprovedReports(reports);
  if (authoritativeReports.length === 0) {
    return {
      authoritativeReports,
      settlementItems: null,
      totalSettlementAmount: null,
      avgSessionMinutes: null,
      actualHourlyRate: null,
      totalGmvAmount: null,
      roiBps: null,
      roi: null,
      viewsPerHour: null,
    };
  }

  const durations = authoritativeReports.map((report) =>
    finiteNumber(report.settlement_duration),
  );
  const totalLiveMinutes = durations.every(isFiniteNumber)
    ? durations.reduce<number>(
        (sum, duration) => sum + Math.max(duration ?? 0, 0),
        0,
      )
    : null;
  const liveHours =
    totalLiveMinutes !== null ? totalLiveMinutes / 60 : null;

  const settlementItems = aggregateUniqueSettlementItems(
    authoritativeReports.map((report) =>
      readReportSettlementItems(
        report,
        expectedOrganizationId,
        expectedStreamerId,
      ),
    ),
  );
  const totalSettlementAmount = settlementItems
    ? roundAmount(
        settlementItems.reduce((sum, item) => sum + item.amount, 0),
      )
    : null;

  const gmvAmounts = authoritativeReports.map(readAttributedGmv);
  const totalGmvAmount = gmvAmounts.every(isFiniteNumber)
    ? roundAmount(
        gmvAmounts.reduce<number>(
          (sum, amount) => sum + (amount ?? 0),
          0,
        ),
      )
    : null;

  const viewers = authoritativeReports.map((report) =>
    finiteNumber(report.viewers),
  );
  const totalViewers = viewers.every(isFiniteNumber)
    ? viewers.reduce<number>(
        (sum, value) => sum + Math.max(value ?? 0, 0),
        0,
      )
    : null;

  return {
    authoritativeReports,
    settlementItems,
    totalSettlementAmount,
    avgSessionMinutes:
      totalLiveMinutes !== null
        ? roundAmount(totalLiveMinutes / authoritativeReports.length)
        : null,
    actualHourlyRate:
      totalSettlementAmount !== null && liveHours !== null && liveHours > 0
        ? roundAmount(totalSettlementAmount / liveHours)
        : null,
    totalGmvAmount,
    roiBps:
      totalGmvAmount !== null &&
      totalSettlementAmount !== null &&
      totalSettlementAmount > 0
        ? Math.round((totalGmvAmount / totalSettlementAmount) * 10000)
        : null,
    roi:
      totalGmvAmount !== null &&
      totalSettlementAmount !== null &&
      totalSettlementAmount > 0
        ? roundAmount(totalGmvAmount / totalSettlementAmount)
        : null,
    viewsPerHour:
      totalViewers !== null && liveHours !== null && liveHours > 0
        ? roundAmount(totalViewers / liveHours)
        : null,
  };
}

function hasReliableItemOwnership(
  item: SettlementItemEvidence,
  report: ReportEconomicsEvidence,
  expectedStreamerId: string | undefined,
  source: "direct" | "junction",
): boolean {
  const batch = first(item.settlement_batches);
  if (
    batch?.batch_type !== "payable" ||
    (batch.status !== "confirmed" && batch.status !== "locked")
  ) {
    return true;
  }
  if (
    expectedStreamerId &&
    item.streamer_id !== expectedStreamerId
  ) {
    return false;
  }
  const itemReportId = nonEmptyString(item.live_report_id);
  const reportId = nonEmptyString(report.id);
  if (source === "junction" && !itemReportId) {
    return false;
  }
  return Boolean(itemReportId && reportId && itemReportId === reportId);
}

function readAttributedGmv(report: ReportEconomicsEvidence): number | null {
  const reportId = nonEmptyString(report.id);
  if (!reportId) return null;
  for (const metric of report.streamer_metrics ?? []) {
    if (
      metric.metric_key === "gmv" &&
      metric.source_report_id === reportId
    ) {
      return finiteNumber(metric.metric_value);
    }
  }
  return null;
}

function compareReportAuthority(
  left: ReportEconomicsEvidence,
  right: ReportEconomicsEvidence,
): number {
  const timeDifference =
    timestamp(left.created_at) - timestamp(right.created_at);
  if (timeDifference !== 0) return timeDifference;
  return (nonEmptyString(left.id) ?? "").localeCompare(
    nonEmptyString(right.id) ?? "",
  );
}

function timestamp(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

function first<T>(value: MaybeRelation<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}
