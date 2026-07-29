import type { ReportSettlementXlsxRow } from "./report-settlement-xlsx";

export type SettlementExportClient = {
  from(table: string): unknown;
};

type ExportQueryBuilder = {
  select(columns: string): ExportQueryBuilder;
  eq(column: string, value: unknown): ExportQueryBuilder;
  in(column: string, values: unknown[]): ExportQueryBuilder;
  gte(column: string, value: unknown): ExportQueryBuilder;
  lte(column: string, value: unknown): ExportQueryBuilder;
  order(column: string, options: { ascending: boolean }): ExportQueryBuilder;
  limit(count: number): ExportQueryBuilder;
  returns<T>(): Promise<{ data: T | null; error: Error | null }>;
};

export type SettlementBatchExportRow = {
  batchName: string;
  ruleLabel: string;
  evidenceLevel: string;
  varianceFlag: string;
  systemAmountCents: number;
  manualAmountCents: number;
  adjustmentAmountCents: number;
  payableAmountCents: number;
  vendorReceivableCents: number;
};

type SettlementBatchRow = {
  id: string;
  batch_type: "payable" | "receivable";
  title?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  computed_amount: number | string | null;
  manual_amount: number | string | null;
  adjustment_amount: number | string | null;
  evidence_summary?: Record<string, unknown> | null;
  projects?: MaybeArray<{ name?: string | null }> | null;
};

type SettlementBatchItemRow = {
  settlement_batch_id: string;
  evidence_level?: "green" | "yellow" | "red" | null;
  evidence_snapshot?: Record<string, unknown> | null;
};

type LiveReportExportRow = {
  id: string;
  settlement_duration?: number | string | null;
  system_duration?: number | string | null;
  evidence_level?: string | null;
  created_at?: string | null;
  settled_batch_item_id?: string | null;
  projects?: MaybeArray<{
    name?: string | null;
    product_name?: string | null;
  }> | null;
  streamers?: MaybeArray<{ display_name?: string | null }> | null;
  live_tasks?: MaybeArray<{
    planned_start_at?: string | null;
    planned_end_at?: string | null;
  }> | null;
};

type SettlementItemAmountRow = {
  id: string;
  computed_amount: number | string | null;
  manual_amount: number | string | null;
  adjustment_amount: number | string | null;
  evidence_snapshot?: Record<string, unknown> | null;
};

type ReportScreenshotCountRow = {
  live_report_id: string;
};

type MaybeArray<T> = T | T[];

const DEFAULT_EXPORT_LIMIT = 200;
const MAX_EXPORT_IDS = 500;

export async function buildSettlementBatchExportRows({
  client,
  organizationId,
  batchIds,
  periodStart,
  periodEnd,
}: {
  client: SettlementExportClient;
  organizationId: string;
  batchIds?: string[];
  periodStart?: string | null;
  periodEnd?: string | null;
}): Promise<SettlementBatchExportRow[]> {
  const requestedBatchIds = normalizeIdList(batchIds);
  let batchQuery = queryFrom(client, "settlement_batches")
    .select(
      "id, batch_type, title, period_start, period_end, computed_amount, manual_amount, adjustment_amount, evidence_summary, projects(name)",
    )
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });

  if (requestedBatchIds.length > 0) {
    batchQuery = batchQuery.in("id", requestedBatchIds);
  } else {
    batchQuery = batchQuery.limit(DEFAULT_EXPORT_LIMIT);
  }
  if (periodStart) {
    batchQuery = batchQuery.gte("period_start", periodStart);
  }
  if (periodEnd) {
    batchQuery = batchQuery.lte("period_end", periodEnd);
  }

  const { data: batchRows, error } =
    await batchQuery.returns<SettlementBatchRow[]>();
  if (error) {
    throw error;
  }

  const batches = batchRows ?? [];
  const ids = batches.map((batch) => batch.id);
  const itemsByBatch = await listSettlementBatchExportItems({
    client,
    organizationId,
    batchIds: ids,
  });

  return batches.map((batch) => {
    const computedAmountCents = yuanToCents(toNumber(batch.computed_amount));
    const manualAmountCents = yuanToCents(toNumber(batch.manual_amount));
    const adjustmentAmountCents = yuanToCents(
      toNumber(batch.adjustment_amount),
    );
    const totalAmountCents =
      computedAmountCents + manualAmountCents + adjustmentAmountCents;
    const isPayable = batch.batch_type === "payable";
    const items = itemsByBatch.get(batch.id) ?? [];

    return {
      batchName: batch.title?.trim() || batchName(batch),
      ruleLabel: aggregateRuleLabels(items),
      evidenceLevel: evidenceSummaryText(batch.evidence_summary, items),
      varianceFlag: hasVariance(batch.evidence_summary, items)
        ? "有差异"
        : "无差异",
      systemAmountCents: computedAmountCents,
      manualAmountCents,
      adjustmentAmountCents,
      payableAmountCents: isPayable ? totalAmountCents : 0,
      vendorReceivableCents: isPayable ? 0 : totalAmountCents,
    };
  });
}

export async function buildReportSettlementExportRows({
  client,
  organizationId,
  organizationName,
  reportIds,
  projectId,
  periodStart,
  periodEnd,
}: {
  client: SettlementExportClient;
  organizationId: string;
  organizationName?: string | null;
  reportIds?: string[];
  projectId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
}): Promise<ReportSettlementXlsxRow[]> {
  const requestedReportIds = normalizeIdList(reportIds);
  let reportQuery = queryFrom(client, "live_reports")
    .select(
      "id, settlement_duration, system_duration, evidence_level, created_at, settled_batch_item_id, projects(name, product_name), streamers(display_name), live_tasks(planned_start_at, planned_end_at)",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (requestedReportIds.length > 0) {
    reportQuery = reportQuery.in("id", requestedReportIds);
  } else {
    reportQuery = reportQuery.limit(DEFAULT_EXPORT_LIMIT);
  }
  if (projectId) {
    reportQuery = reportQuery.eq("project_id", projectId);
  }
  if (periodStart) {
    reportQuery = reportQuery.gte("created_at", `${periodStart}T00:00:00.000Z`);
  }
  if (periodEnd) {
    reportQuery = reportQuery.lte("created_at", `${periodEnd}T23:59:59.999Z`);
  }

  const { data: reportRows, error } =
    await reportQuery.returns<LiveReportExportRow[]>();
  if (error) {
    throw error;
  }

  const reports = reportRows ?? [];
  const itemById = await listSettlementItemsById({
    client,
    organizationId,
    itemIds: reports
      .map((report) => report.settled_batch_item_id)
      .filter((id): id is string => Boolean(id)),
  });
  const screenshotCounts = await countScreenshotsByReport({
    client,
    reportIds: reports.map((report) => report.id),
  });

  return reports.map((report) => {
    const project = first(report.projects);
    const streamer = first(report.streamers);
    const task = first(report.live_tasks);
    const item = report.settled_batch_item_id
      ? itemById.get(report.settled_batch_item_id)
      : undefined;
    const durationMinutes =
      toNumber(report.settlement_duration) || toNumber(report.system_duration);
    const totalAmount =
      item == null
        ? null
        : toNumber(item.computed_amount) +
          toNumber(item.manual_amount) +
          toNumber(item.adjustment_amount);
    const hourlyRate = item
      ? legacyHourlyRateFromSnapshot(item.evidence_snapshot)
      : null;

    return {
      reportId: report.id,
      guildOrIndividual: organizationName?.trim() || "—",
      gameProduct: project?.product_name || project?.name || "—",
      streamerName: streamer?.display_name || "未知主播",
      liveDate: dateText(report.created_at),
      liveTime: timeRangeText(task),
      duration: `${formatHours(durationMinutes)} 小时`,
      hourlyRate: hourlyRate == null ? "—" : `¥${formatYuan(hourlyRate)}`,
      talentFee: totalAmount == null ? "—" : `¥${formatMoney(totalAmount)}`,
      screenshot: `${screenshotCounts.get(report.id) ?? 0} 张`,
    };
  });
}

async function listSettlementBatchExportItems({
  client,
  organizationId,
  batchIds,
}: {
  client: SettlementExportClient;
  organizationId: string;
  batchIds: string[];
}): Promise<Map<string, SettlementBatchItemRow[]>> {
  if (batchIds.length === 0) {
    return new Map();
  }
  const { data, error } = await queryFrom(client, "settlement_batch_items")
    .select("settlement_batch_id, evidence_level, evidence_snapshot")
    .eq("organization_id", organizationId)
    .in("settlement_batch_id", batchIds)
    .returns<SettlementBatchItemRow[]>();
  if (error) {
    throw error;
  }

  const grouped = new Map<string, SettlementBatchItemRow[]>();
  for (const item of data ?? []) {
    grouped.set(item.settlement_batch_id, [
      ...(grouped.get(item.settlement_batch_id) ?? []),
      item,
    ]);
  }
  return grouped;
}

async function listSettlementItemsById({
  client,
  organizationId,
  itemIds,
}: {
  client: SettlementExportClient;
  organizationId: string;
  itemIds: string[];
}): Promise<Map<string, SettlementItemAmountRow>> {
  const ids = normalizeIdList(itemIds);
  if (ids.length === 0) {
    return new Map();
  }
  const { data, error } = await queryFrom(client, "settlement_batch_items")
    .select(
      "id, computed_amount, manual_amount, adjustment_amount, evidence_snapshot",
    )
    .eq("organization_id", organizationId)
    .in("id", ids)
    .returns<SettlementItemAmountRow[]>();
  if (error) {
    throw error;
  }
  return new Map((data ?? []).map((item) => [item.id, item]));
}

async function countScreenshotsByReport({
  client,
  reportIds,
}: {
  client: SettlementExportClient;
  reportIds: string[];
}): Promise<Map<string, number>> {
  const ids = normalizeIdList(reportIds);
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await queryFrom(client, "report_screenshots")
    .select("live_report_id")
    .in("live_report_id", ids)
    .returns<ReportScreenshotCountRow[]>();
  if (error) {
    throw error;
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.live_report_id, (counts.get(row.live_report_id) ?? 0) + 1);
  }
  return counts;
}

function queryFrom(
  client: SettlementExportClient,
  table: string,
): ExportQueryBuilder {
  return client.from(table) as ExportQueryBuilder;
}

function normalizeIdList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  ).slice(0, MAX_EXPORT_IDS);
}

function batchName(batch: SettlementBatchRow): string {
  const project = first(batch.projects);
  const typeLabel = batch.batch_type === "payable" ? "主播应付" : "厂家应收";
  return `${project?.name || "未知项目"} · ${typeLabel}`;
}

function aggregateRuleLabels(items: SettlementBatchItemRow[]): string {
  const labels = Array.from(
    new Set(
      items
        .map((item) => ruleLabelFromSnapshot(item.evidence_snapshot))
        .filter((label): label is string => Boolean(label)),
    ),
  );
  if (labels.length === 0) {
    return "—";
  }
  return labels.slice(0, 3).join(" / ");
}

function ruleLabelFromSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
): string | null {
  const ruleEngine = recordValue(snapshot?.ruleEngine);
  if (ruleEngine) {
    const labels = arrayValue(ruleEngine.appliedLayers)
      .map((layer) => {
        if (typeof layer === "string") {
          return `规则版本 ${shortVersionId(layer)}`;
        }
        const record = recordValue(layer);
        if (!record) return null;
        return (
          stringValue(record.versionLabel) ??
          stringValue(record.label) ??
          stringValue(record.name) ??
          versionLabelFromId(stringValue(record.versionId))
        );
      })
      .filter((label): label is string => Boolean(label));
    return labels.length ? labels.join(" / ") : "自定义规则";
  }

  const legacyRule = recordValue(recordValue(snapshot?.legacyEngine)?.rule);
  const method = stringValue(legacyRule?.settlementMethod);
  return method ? `固定规则 · ${settlementMethodLabel(method)}` : null;
}

function evidenceSummaryText(
  summary: Record<string, unknown> | null | undefined,
  items: SettlementBatchItemRow[],
): string {
  const green = countEvidence("green", summary, items);
  const yellow = countEvidence("yellow", summary, items);
  const red = countEvidence("red", summary, items);
  const unknown = countEvidence("unknown", summary, items);
  return `绿 ${green} / 黄 ${yellow} / 红 ${red} / 未知 ${unknown}`;
}

function hasVariance(
  summary: Record<string, unknown> | null | undefined,
  items: SettlementBatchItemRow[],
): boolean {
  return (
    countEvidence("yellow", summary, items) > 0 ||
    countEvidence("red", summary, items) > 0
  );
}

function countEvidence(
  key: "green" | "yellow" | "red" | "unknown",
  summary: Record<string, unknown> | null | undefined,
  items: SettlementBatchItemRow[],
): number {
  const value = summary?.[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (key === "unknown") {
    return items.filter((item) => !item.evidence_level).length;
  }
  return items.filter((item) => item.evidence_level === key).length;
}

function legacyHourlyRateFromSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
): number | null {
  const rule = recordValue(recordValue(snapshot?.legacyEngine)?.rule);
  return numberValue(rule?.hourlyRate);
}

function timeRangeText(
  task: { planned_start_at?: string | null; planned_end_at?: string | null } | null,
): string {
  const start = timeText(task?.planned_start_at);
  const end = timeText(task?.planned_end_at);
  return start && end ? `${start}-${end}` : "—";
}

function timeText(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/T(\d{2}):(\d{2})/u);
  return match ? `${match[1]}:${match[2]}` : null;
}

function dateText(value: string | null | undefined): string {
  return value?.slice(0, 10) || "—";
}

function formatHours(minutes: number): string {
  return formatYuan(Math.round((minutes / 60) * 10) / 10);
}

function formatYuan(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
}

function formatMoney(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function yuanToCents(value: number): number {
  return Math.round(value * 100);
}

function first<T>(value: MaybeArray<T> | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function versionLabelFromId(versionId: string | null): string | null {
  return versionId ? `规则版本 ${shortVersionId(versionId)}` : null;
}

function shortVersionId(versionId: string): string {
  const uuidMatch = versionId.match(
    /^([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  if (uuidMatch) {
    return uuidMatch[1];
  }
  const parts = versionId.split(/[-_:]/u).filter(Boolean);
  const tail = parts[parts.length - 1];
  if (tail && tail.length >= 6) {
    return tail.slice(0, 8);
  }
  return versionId.length <= 16 ? versionId : versionId.slice(0, 16);
}

function settlementMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    cpt: "时长计费",
    base_salary: "底薪",
    base_salary_cpt: "底薪 + 时长计费",
    cps: "CPS 抽成",
    cpa: "CPA",
    gift: "礼物流水",
    manual: "人工结算",
  };
  return labels[method] ?? "人工结算";
}
