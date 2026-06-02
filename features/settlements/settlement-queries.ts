import type { SupabaseClient } from "@supabase/supabase-js";

import { calculateSettlementItem } from "./settlement-engine";
import type {
  SettlementBatchStatus,
  SettlementBatchType,
} from "./settlement-service";

export type OpsSettlementPoolItem = {
  id: string;
  projectName: string;
  streamerName: string;
  settlementDuration: number | null;
  timeSource: "system" | "screenshot" | "claimed" | null;
  evidenceLevel: "green" | "yellow" | "red" | null;
  settlementMethod: string;
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
};

export type OpsSettlementDefaultScope = {
  projectId: string;
  periodStart: string;
  periodEnd: string;
  poolCount: number;
};

export type SettlementPoolRow = {
  id: string;
  created_at: string;
  settlement_duration: number | null;
  time_source: "system" | "screenshot" | "claimed" | null;
  evidence_level: "green" | "yellow" | "red" | null;
  projects: { name: string } | { name: string }[] | null;
  streamers: { display_name: string } | { display_name: string }[] | null;
  project_streamers?: Array<{
    settlement_method: string | null;
    hourly_rate: number | null;
    base_salary: number | null;
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

type PoolQueryRow = Omit<SettlementPoolRow, "project_streamers"> & {
  project_id: string;
  streamer_id: string;
};

type ProjectStreamerRuleRow = {
  streamer_id: string;
  settlement_method: string | null;
  hourly_rate: number | null;
  base_salary: number | null;
};

type SettlementScopeSeedRow = {
  project_id: string;
};

export async function listOpsSettlementPool(
  client: SupabaseClient,
  input: { projectId: string; periodStart: string; periodEnd: string },
): Promise<OpsSettlementPoolItem[]> {
  const { data, error } = await client
    .from("live_reports")
    .select(
      "id, project_id, streamer_id, created_at, settlement_duration, time_source, evidence_level, projects(name), streamers(display_name)",
    )
    .eq("project_id", input.projectId)
    .eq("status", "approved")
    .eq("enter_settlement_pool", true)
    .is("settled_batch_item_id", null)
    .gte("created_at", `${input.periodStart}T00:00:00.000Z`)
    .lte("created_at", `${input.periodEnd}T23:59:59.999Z`)
    .order("created_at", { ascending: true })
    .returns<PoolQueryRow[]>();

  if (error) {
    throw error;
  }

  const streamerIds = Array.from(
    new Set((data ?? []).map((row) => row.streamer_id)),
  );
  const rules = streamerIds.length
    ? await listProjectStreamerRules(client, input.projectId, streamerIds)
    : [];
  const rulesByStreamer = new Map(
    rules.map((rule) => [rule.streamer_id, rule] as const),
  );

  return (data ?? []).map((row) =>
    toOpsSettlementPoolItem({
      ...row,
      project_streamers: [
        rulesByStreamer.get(row.streamer_id) ?? {
          settlement_method: "manual",
          hourly_rate: 0,
          base_salary: 0,
        },
      ],
    }),
  );
}

export async function listOpsSettlementBatches(
  client: SupabaseClient,
): Promise<OpsSettlementBatchListItem[]> {
  const { data, error } = await client
    .from("settlement_batches")
    .select(
      "id, project_id, batch_type, status, period_start, period_end, computed_amount, manual_amount, adjustment_amount, evidence_summary, updated_at, created_by, projects(name), settlement_batch_items(id)",
    )
    .order("updated_at", { ascending: false })
    .returns<SettlementBatchRow[]>();

  if (error) {
    throw error;
  }

  return (data ?? []).map(toOpsSettlementBatchListItem);
}

export async function listOpsSettlementBatchDetails(
  client: SupabaseClient,
  batchId?: string,
): Promise<Record<string, OpsSettlementBatchDetailItem[]>> {
  let query = client
    .from("settlement_batch_items")
    .select(
      "id, settlement_batch_id, item_type, computed_amount, manual_amount, adjustment_amount, evidence_level, evidence_snapshot, streamers(display_name)",
    )
    .order("created_at", { ascending: true });

  if (batchId) {
    query = query.eq("settlement_batch_id", batchId);
  }

  const { data, error } = await query.returns<SettlementBatchDetailRow[]>();

  if (error) {
    throw error;
  }

  return (data ?? []).reduce<Record<string, OpsSettlementBatchDetailItem[]>>(
    (grouped, row) => {
      const item = toOpsSettlementBatchDetailItem(row);
      grouped[item.batchId] = [...(grouped[item.batchId] ?? []), item];
      return grouped;
    },
    {},
  );
}

export async function getOpsSettlementDefaultScope(
  client: SupabaseClient,
): Promise<OpsSettlementDefaultScope | null> {
  const { data: poolRows, error } = await client
    .from("live_reports")
    .select("project_id")
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
  const periodStart = dateKey(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const poolCount = await countSettlementPoolReports(client, {
    projectId,
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
    },
  });

  return {
    id: row.id,
    projectName: project?.name ?? "Unknown project",
    streamerName: streamer?.display_name ?? "Unknown streamer",
    settlementDuration: row.settlement_duration,
    timeSource: row.time_source,
    evidenceLevel: row.evidence_level,
    settlementMethod: rule?.settlement_method ?? "manual",
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
    evidenceSummary: row.evidence_summary,
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
  };
}

async function listProjectStreamerRules(
  client: SupabaseClient,
  projectId: string,
  streamerIds: string[],
): Promise<ProjectStreamerRuleRow[]> {
  const { data, error } = await client
    .from("project_streamers")
    .select("streamer_id, settlement_method, hourly_rate, base_salary")
    .eq("project_id", projectId)
    .in("streamer_id", streamerIds)
    .returns<ProjectStreamerRuleRow[]>();

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function countSettlementPoolReports(
  client: SupabaseClient,
  input: { projectId: string; periodStart: string; periodEnd: string },
): Promise<number> {
  const { count, error } = await client
    .from("live_reports")
    .select("id", { count: "exact", head: true })
    .eq("project_id", input.projectId)
    .eq("status", "approved")
    .eq("enter_settlement_pool", true)
    .is("settled_batch_item_id", null)
    .gte("created_at", `${input.periodStart}T00:00:00.000Z`)
    .lte("created_at", `${input.periodEnd}T23:59:59.999Z`);

  if (error) {
    throw error;
  }

  return count ?? 0;
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
