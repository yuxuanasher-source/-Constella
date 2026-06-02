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
      "id, batch_type, status, period_start, period_end, computed_amount, manual_amount, adjustment_amount, evidence_summary, updated_at, created_by, projects(name), settlement_batch_items(id)",
    )
    .order("updated_at", { ascending: false })
    .returns<SettlementBatchRow[]>();

  if (error) {
    throw error;
  }

  return (data ?? []).map(toOpsSettlementBatchListItem);
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

function first<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
