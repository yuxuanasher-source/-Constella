import type { SupabaseClient } from "@supabase/supabase-js";

import { calculateSettlementItem } from "./settlement-engine";
import { extractStructuredSettlementRule } from "./structured-settlement-rule";
import type {
  SettlementBatchStatus,
  SettlementBatchType,
} from "./settlement-service";

export type OpsSettlementPoolItem = {
  id: string;
  projectId: string;
  projectName: string;
  streamerName: string;
  settlementDuration: number | null;
  timeSource: "system" | "screenshot" | "claimed" | null;
  evidenceLevel: "green" | "yellow" | "red" | null;
  settlementMethod: string;
  cpsRateBps: number;
  expectedAmount: number;
  approvedAt: string;
};

export type OpsSettlementBatchListItem = {
  id: string;
  projectId: string;
  batchType: SettlementBatchType;
  status: SettlementBatchStatus;
  projectName: string;
  periodStart: string;
  periodEnd: string;
  computedAmount: number;
  manualAmount: number;
  adjustmentAmount: number;
  totalAmount: number;
  evidenceSummary: Record<string, unknown>;
  itemCount: number;
  createdBy: string | null;
  updatedAt: string;
};

export type OpsSettlementBatchDetailItem = {
  id: string;
  batchId: string;
  itemType: string;
  streamerName: string;
  settlementDuration: number;
  timeSource: string;
  evidenceLevel: "green" | "yellow" | "red" | null;
  systemAmount: number;
  manualAmount: number;
  adjustmentAmount: number;
  totalAmount: number;
  internalOnly?: boolean;
  sourceKind?: "settlement" | "project_cost";
};

export type OpsSettlementDefaultScope = {
  projectId: string;
  periodStart: string;
  periodEnd: string;
  poolCount: number;
};

export type SettlementPoolRow = {
  id: string;
  project_id?: string;
  created_at: string;
  settlement_duration: number | null;
  time_source: "system" | "screenshot" | "claimed" | null;
  evidence_level: "green" | "yellow" | "red" | null;
  projects:
    | { name: string; default_settlement_rule?: unknown }
    | { name: string; default_settlement_rule?: unknown }[]
    | null;
  streamers: { display_name: string } | { display_name: string }[] | null;
  project_streamers?: Array<{
    settlement_method: string | null;
    hourly_rate: number | null;
    base_salary: number | null;
    cps_rate_bps: number | null;
  }> | null;
};

export type SettlementBatchRow = {
  id: string;
  project_id: string;
  batch_type: SettlementBatchType;
  status: SettlementBatchStatus;
  period_start: string;
  period_end: string;
  computed_amount: number;
  manual_amount: number;
  adjustment_amount: number;
  evidence_summary: Record<string, unknown>;
  updated_at: string;
  created_by: string | null;
  projects: { name: string } | { name: string }[] | null;
  settlement_batch_items: Array<{ id: string }> | null;
};

export type SettlementBatchDetailRow = {
  id: string;
  settlement_batch_id: string;
  item_type: string;
  computed_amount: number;
  manual_amount: number;
  adjustment_amount: number;
  evidence_level: "green" | "yellow" | "red" | null;
  evidence_snapshot: Record<string, unknown>;
  streamers: { display_name: string } | { display_name: string }[] | null;
};

export type SettlementBatchCostItemRow = {
  id: string;
  settlement_batch_id: string;
  item_type: string;
  amount_cents: number;
  direction: "cost" | "revenue_offset" | "adjustment";
  evidence_level: "green" | "yellow" | "red";
  source: "system" | "import" | "manual";
  reason: string;
};

type PoolQueryRow = Omit<SettlementPoolRow, "project_streamers"> & {
  project_id: string;
  streamer_id: string;
};

type ProjectStreamerRuleRow = {
  project_id: string;
  streamer_id: string;
  settlement_method: string | null;
  hourly_rate: number | null;
  base_salary: number | null;
  cps_rate_bps: number | null;
};

type SettlementScopeSeedRow = {
  project_id: string;
  created_at?: string;
};

export async function listOpsSettlementPool(
  client: SupabaseClient,
  input: {
    organizationId: string;
    projectId?: string | null;
    batchType?: SettlementBatchType;
    periodStart: string;
    periodEnd: string;
  },
): Promise<OpsSettlementPoolItem[]> {
  let query = client
    .from("live_reports")
    .select(
      "id, project_id, streamer_id, created_at, settlement_duration, time_source, evidence_level, projects(name, default_settlement_rule), streamers(display_name)",
    )
    .eq("organization_id", input.organizationId)
    .eq("status", "approved")
    .eq("enter_settlement_pool", true)
    .gte("created_at", `${input.periodStart}T00:00:00.000Z`)
    .lte("created_at", `${input.periodEnd}T23:59:59.999Z`)
    .order("created_at", { ascending: true });

  if (input.projectId) {
    query = query.eq("project_id", input.projectId);
  }

  const { data, error } = await query.returns<PoolQueryRow[]>();

  if (error) {
    throw error;
  }

  const batchType = input.batchType ?? "payable";
  const reportIds = (data ?? []).map((row) => row.id);
  const settledReportIds = reportIds.length
    ? await listSettledReportIdsForBatchType(
        client,
        input.organizationId,
        reportIds,
        batchType,
      )
    : new Set<string>();
  const unsettledRows = (data ?? []).filter(
    (row) => !settledReportIds.has(row.id),
  );
  const streamerIds = Array.from(
    new Set(unsettledRows.map((row) => row.streamer_id)),
  );
  const projectIds = Array.from(
    new Set(unsettledRows.map((row) => row.project_id)),
  );
  const rules =
    streamerIds.length && projectIds.length
      ? await listProjectStreamerRules(
          client,
          input.organizationId,
          projectIds,
          streamerIds,
        )
      : [];
  const rulesByStreamer = new Map(
    rules.map(
      (rule) =>
        [
          projectStreamerRuleKey(rule.project_id, rule.streamer_id),
          rule,
        ] as const,
    ),
  );

  return unsettledRows.map((row) =>
    toOpsSettlementPoolItem({
      ...row,
      project_streamers: [
        rulesByStreamer.get(
          projectStreamerRuleKey(row.project_id, row.streamer_id),
        ) ?? {
          settlement_method: "manual",
          hourly_rate: 0,
          base_salary: 0,
          cps_rate_bps: 0,
        },
      ],
    }),
  );
}

export async function listOpsSettlementBatches(
  client: SupabaseClient,
  organizationId: string,
): Promise<OpsSettlementBatchListItem[]> {
  // 防线：批次列表按更新时间倒序取最新 200 条，避免历史批次增长后拖全表。
  const { data, error } = await client
    .from("settlement_batches")
    .select(
      "id, project_id, batch_type, status, period_start, period_end, computed_amount, manual_amount, adjustment_amount, evidence_summary, updated_at, created_by, projects(name), settlement_batch_items(id)",
    )
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(200)
    .returns<SettlementBatchRow[]>();

  if (error) {
    throw error;
  }

  return (data ?? []).map(toOpsSettlementBatchListItem);
}

export async function listOpsSettlementBatchDetails(
  client: SupabaseClient,
  input: {
    organizationId: string;
    batchId?: string;
  },
): Promise<Record<string, OpsSettlementBatchDetailItem[]>> {
  let query = client
    .from("settlement_batch_items")
    .select(
      "id, settlement_batch_id, item_type, computed_amount, manual_amount, adjustment_amount, evidence_level, evidence_snapshot, streamers(display_name)",
    )
    .eq("organization_id", input.organizationId)
    .order("created_at", { ascending: true });

  if (input.batchId) {
    query = query.eq("settlement_batch_id", input.batchId);
  }

  let costQuery = client
    .from("project_cost_items")
    .select(
      "id, settlement_batch_id, item_type, amount_cents, direction, evidence_level, source, reason",
    )
    .eq("organization_id", input.organizationId)
    .not("settlement_batch_id", "is", null)
    .order("created_at", { ascending: true });

  if (input.batchId) {
    costQuery = costQuery.eq("settlement_batch_id", input.batchId);
  }

  // 两条查询互不依赖，并行执行以缩短结算中心首屏耗时。
  const [{ data, error }, { data: costRows, error: costError }] =
    await Promise.all([
      query.returns<SettlementBatchDetailRow[]>(),
      costQuery.returns<SettlementBatchCostItemRow[]>(),
    ]);

  if (error) {
    throw error;
  }

  if (costError) {
    throw costError;
  }

  const detailItems = [
    ...(data ?? []).map(toOpsSettlementBatchDetailItem),
    ...(costRows ?? []).map(toOpsSettlementBatchCostDetailItem),
  ];

  return detailItems.reduce<Record<string, OpsSettlementBatchDetailItem[]>>(
    (grouped, row) => {
      grouped[row.batchId] = [...(grouped[row.batchId] ?? []), row];
      return grouped;
    },
    {},
  );
}

export async function getOpsSettlementDefaultScope(
  client: SupabaseClient,
  organizationId: string,
): Promise<OpsSettlementDefaultScope | null> {
  const { data: poolRows, error } = await client
    .from("live_reports")
    .select("project_id, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "approved")
    .eq("enter_settlement_pool", true)
    .is("settled_batch_item_id", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .returns<SettlementScopeSeedRow[]>();

  if (error) {
    throw error;
  }

  let projectId = poolRows?.[0]?.project_id ?? null;
  if (!projectId) {
    const { data: batchRows, error: batchError } = await client
      .from("settlement_batches")
      .select("project_id")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .returns<SettlementScopeSeedRow[]>();

    if (batchError) {
      throw batchError;
    }

    projectId = batchRows?.[0]?.project_id ?? null;
  }

  if (!projectId) {
    return null;
  }

  const periodEnd = dateKey(new Date());
  const periodStart = poolRows?.[0]?.created_at
    ? dateKey(new Date(poolRows[0].created_at))
    : dateKey(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const poolCount = await countSettlementPoolReports(client, {
    organizationId,
    periodStart,
    periodEnd,
  });

  return { projectId, periodStart, periodEnd, poolCount };
}

export function toOpsSettlementPoolItem(
  row: SettlementPoolRow,
): OpsSettlementPoolItem {
  const project = first(row.projects);
  const streamer = first(row.streamers);
  const rule = first(row.project_streamers ?? null);
  const structured = extractStructuredSettlementRule(
    project?.default_settlement_rule,
  );
  const expected = calculateSettlementItem({
    report: {
      id: row.id,
      settlementDuration: row.settlement_duration,
      timeSource: row.time_source,
      evidenceLevel: row.evidence_level,
    },
    rule: {
      settlementMethod:
        (rule?.settlement_method as Parameters<
          typeof calculateSettlementItem
        >[0]["rule"]["settlementMethod"]) ?? "manual",
      hourlyRate: rule?.hourly_rate ?? 0,
      baseSalary: rule?.base_salary ?? 0,
      cpsRateBps: rule?.cps_rate_bps ?? 0,
      ...structured,
    },
  });

  return {
    id: row.id,
    projectId: row.project_id ?? "unknown-project",
    projectName: project?.name ?? "Unknown project",
    streamerName: streamer?.display_name ?? "Unknown streamer",
    settlementDuration: row.settlement_duration,
    timeSource: row.time_source,
    evidenceLevel: row.evidence_level,
    settlementMethod: rule?.settlement_method ?? "manual",
    cpsRateBps: rule?.cps_rate_bps ?? 0,
    expectedAmount: expected.computedAmount,
    approvedAt: row.created_at,
  };
}

export function toOpsSettlementBatchListItem(
  row: SettlementBatchRow,
): OpsSettlementBatchListItem {
  const project = first(row.projects);
  const totalAmount =
    Number(row.computed_amount) +
    Number(row.manual_amount) +
    Number(row.adjustment_amount);

  return {
    id: row.id,
    projectId: row.project_id,
    batchType: row.batch_type,
    status: row.status,
    projectName: project?.name ?? "Unknown project",
    periodStart: row.period_start,
    periodEnd: row.period_end,
    computedAmount: Number(row.computed_amount),
    manualAmount: Number(row.manual_amount),
    adjustmentAmount: Number(row.adjustment_amount),
    totalAmount,
    evidenceSummary: camelizeRecord(row.evidence_summary),
    itemCount: row.settlement_batch_items?.length ?? 0,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
  };
}

export function toOpsSettlementBatchDetailItem(
  row: SettlementBatchDetailRow,
): OpsSettlementBatchDetailItem {
  const streamer = first(row.streamers);
  const settlementDuration = numberFromSnapshot(
    row.evidence_snapshot,
    "settlementDuration",
  );
  const timeSource = stringFromSnapshot(row.evidence_snapshot, "timeSource");
  const systemAmount = Number(row.computed_amount);
  const manualAmount = Number(row.manual_amount);
  const adjustmentAmount = Number(row.adjustment_amount);

  return {
    id: row.id,
    batchId: row.settlement_batch_id,
    itemType: row.item_type,
    streamerName:
      streamer?.display_name ??
      (row.item_type === "live_report" ? "Unknown streamer" : "人工承载"),
    settlementDuration,
    timeSource:
      timeSource ||
      stringFromSnapshot(row.evidence_snapshot, "source") ||
      "manual",
    evidenceLevel: row.evidence_level,
    systemAmount,
    manualAmount,
    adjustmentAmount,
    totalAmount: systemAmount + manualAmount + adjustmentAmount,
    sourceKind: "settlement",
  };
}

export function toOpsSettlementBatchCostDetailItem(
  row: SettlementBatchCostItemRow,
): OpsSettlementBatchDetailItem {
  const amount = Number(row.amount_cents);
  return {
    id: row.id,
    batchId: row.settlement_batch_id,
    itemType: row.item_type,
    streamerName: "Project cost",
    settlementDuration: 0,
    timeSource: row.source,
    evidenceLevel: row.evidence_level,
    systemAmount: 0,
    manualAmount: amount,
    adjustmentAmount: 0,
    totalAmount: amount,
    internalOnly: true,
    sourceKind: "project_cost",
  };
}

export function toStreamerSafeSettlementBatchDetailItems(
  items: OpsSettlementBatchDetailItem[],
): OpsSettlementBatchDetailItem[] {
  return items.filter((item) => !item.internalOnly);
}

async function listProjectStreamerRules(
  client: SupabaseClient,
  organizationId: string,
  projectIds: string[],
  streamerIds: string[],
): Promise<ProjectStreamerRuleRow[]> {
  const { data, error } = await client
    .from("project_streamers")
    .select(
      "project_id, streamer_id, settlement_method, hourly_rate, base_salary, cps_rate_bps",
    )
    .eq("organization_id", organizationId)
    .in("project_id", projectIds)
    .in("streamer_id", streamerIds)
    .returns<ProjectStreamerRuleRow[]>();

  if (error) {
    throw error;
  }

  return data ?? [];
}

function projectStreamerRuleKey(projectId: string, streamerId: string) {
  return `${projectId}:${streamerId}`;
}

// 与 listOpsSettlementPool 同语义的计数：周期内已审核入池、且尚未进入
// 对应类型批次的报告数。两段都用 head+count 计数，不再把 id 列表拉到
// 内存：第二段从 live_reports 侧 inner join 批次项——嵌套资源不放大主表
// 行数，每份报告只计一次，与原先 Set 去重后再比对的语义一致。
async function countSettlementPoolReports(
  client: SupabaseClient,
  input: {
    organizationId: string;
    projectId?: string | null;
    batchType?: SettlementBatchType;
    periodStart: string;
    periodEnd: string;
  },
): Promise<number> {
  let pooledQuery = client
    .from("live_reports")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", input.organizationId)
    .eq("status", "approved")
    .eq("enter_settlement_pool", true)
    .gte("created_at", `${input.periodStart}T00:00:00.000Z`)
    .lte("created_at", `${input.periodEnd}T23:59:59.999Z`);

  if (input.projectId) {
    pooledQuery = pooledQuery.eq("project_id", input.projectId);
  }

  const { count: pooledCount, error } = await pooledQuery;

  if (error) {
    throw error;
  }

  if (!pooledCount) {
    return 0;
  }

  // 已入对应类型批次的入池报告数（同一周期与过滤条件）。
  let settledQuery = client
    .from("live_reports")
    .select(
      "id, settlement_batch_items!settlement_batch_items_live_report_id_fkey!inner(id, settlement_batches!inner(batch_type))",
      { count: "exact", head: true },
    )
    .eq("organization_id", input.organizationId)
    .eq("status", "approved")
    .eq("enter_settlement_pool", true)
    .gte("created_at", `${input.periodStart}T00:00:00.000Z`)
    .lte("created_at", `${input.periodEnd}T23:59:59.999Z`)
    .eq("settlement_batch_items.organization_id", input.organizationId)
    .eq(
      "settlement_batch_items.settlement_batches.batch_type",
      input.batchType ?? "payable",
    );

  if (input.projectId) {
    settledQuery = settledQuery.eq("project_id", input.projectId);
  }

  const { count: settledCount, error: settledError } = await settledQuery;

  if (settledError) {
    throw settledError;
  }

  return Math.max(pooledCount - (settledCount ?? 0), 0);
}

async function listSettledReportIdsForBatchType(
  client: SupabaseClient,
  organizationId: string,
  reportIds: string[],
  batchType: SettlementBatchType,
): Promise<Set<string>> {
  const { data, error } = await client
    .from("settlement_batch_items")
    .select("live_report_id, settlement_batches!inner(batch_type)")
    .eq("organization_id", organizationId)
    .in("live_report_id", reportIds)
    .eq("settlement_batches.batch_type", batchType)
    .returns<
      Array<{
        live_report_id: string | null;
        settlement_batches:
          | { batch_type: SettlementBatchType }
          | Array<{ batch_type: SettlementBatchType }>
          | null;
      }>
    >();

  if (error) {
    throw error;
  }

  return new Set(
    (data ?? [])
      .filter((row) => hasBatchType(row.settlement_batches, batchType))
      .map((row) => row.live_report_id)
      .filter((id): id is string => Boolean(id)),
  );
}

function hasBatchType(
  relation:
    | { batch_type: SettlementBatchType }
    | Array<{ batch_type: SettlementBatchType }>
    | null,
  batchType: SettlementBatchType,
): boolean {
  if (!relation) {
    return false;
  }

  return Array.isArray(relation)
    ? relation.some((item) => item.batch_type === batchType)
    : relation.batch_type === batchType;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function first<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function numberFromSnapshot(
  snapshot: Record<string, unknown>,
  key: string,
): number {
  const value = snapshot[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringFromSnapshot(
  snapshot: Record<string, unknown>,
  key: string,
): string {
  const value = snapshot[key];
  return typeof value === "string" ? value : "";
}

function camelizeRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      camelizeKey(key),
      camelizeValue(nestedValue),
    ]),
  );
}

function camelizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(camelizeValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return camelizeRecord(value as Record<string, unknown>);
}

function camelizeKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
