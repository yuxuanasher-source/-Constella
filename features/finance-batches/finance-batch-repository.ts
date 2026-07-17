import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EvidenceLevel,
  TimeSource,
} from "@/features/live-operations/live-report-evidence";
import type { SettlementMethod } from "@/features/settlements/settlement-engine";

import type {
  FinanceAdjustmentDirection,
  FinanceBatchAdjustmentRecord,
  FinanceBatchItemRecord,
  FinanceBatchRecord,
  FinanceBatchStatus,
  FinanceBatchType,
  FinanceCounterpartyType,
  FinanceSourceType,
} from "./finance-batch-types";
import type {
  FinanceBatchAtomicItemInput,
  FinanceBatchRepository,
  StreamerPayableSource,
} from "./finance-batch-service";
import {
  toOpsReferenceFinanceBatch,
  type OpsReferenceFinanceBatch,
} from "./finance-batch-ui-adapters";

type JsonRecord = Record<string, unknown>;

export type FinanceBatchRow = {
  id: string;
  organization_id: string;
  batch_type: FinanceBatchType;
  title: string | null;
  period_start: string;
  period_end: string;
  status: FinanceBatchStatus;
  has_exceptions: boolean;
  system_amount: number | string;
  adjustment_amount: number | string;
  final_amount: number | string;
  item_count: number;
  exception_count: number;
  created_by: string | null;
  status_reason: string | null;
  metadata: JsonRecord | null;
  created_at: string;
  updated_at: string;
};

export type FinanceBatchItemRow = {
  id: string;
  organization_id: string;
  finance_batch_id: string;
  batch_type: FinanceBatchType;
  project_id: string;
  counterparty_type: FinanceCounterpartyType;
  counterparty_id: string | null;
  counterparty_name_snapshot: string | null;
  source_type: FinanceSourceType;
  source_id: string;
  source_snapshot: JsonRecord | null;
  system_amount: number | string;
  adjustment_amount: number | string;
  final_amount: number | string;
  evidence_level: string | null;
  evidence_snapshot: JsonRecord | null;
  status: "active" | "voided";
  exception_flags: string[] | null;
  created_at: string;
  updated_at: string;
};

export type FinanceBatchAdjustmentRow = {
  id: string;
  organization_id: string;
  finance_batch_id: string;
  finance_batch_item_id: string | null;
  direction: FinanceAdjustmentDirection;
  amount: number | string;
  reason: string;
  evidence_snapshot: JsonRecord | null;
  created_by: string | null;
  created_at: string;
  voided_at: string | null;
};

type StreamerPayableLiveReportRow = {
  id: string;
  organization_id: string;
  project_id: string;
  streamer_id: string;
  settlement_duration: number | null;
  time_source: TimeSource | null;
  evidence_level: EvidenceLevel | null;
  created_at: string;
  projects:
    | { name: string | null; code: string | null }
    | Array<{ name: string | null; code: string | null }>
    | null;
  streamers:
    | { display_name: string | null }
    | Array<{ display_name: string | null }>
    | null;
};

type ProjectStreamerSettlementRuleRow = {
  project_id: string;
  streamer_id: string;
  settlement_method: SettlementMethod | null;
  hourly_rate: number | string | null;
  base_salary: number | string | null;
  cps_rate_bps: number | string | null;
};

type LegacyConsumedSettlementBatchItemReportRow = {
  live_report_id: string | null;
  settlement_batch_items:
    | {
        organization_id: string | null;
        settlement_batches:
          | { batch_type: string | null; status: string | null }
          | Array<{ batch_type: string | null; status: string | null }>
          | null;
      }
    | Array<{
        organization_id: string | null;
        settlement_batches:
          | { batch_type: string | null; status: string | null }
          | Array<{ batch_type: string | null; status: string | null }>
          | null;
      }>
    | null;
};

type FinanceBatchProjectSummaryRow = {
  finance_batch_id: string | null;
  project_id: string | null;
  receivable_amount: number | string | null;
  streamer_payable_amount: number | string | null;
  project_cost_amount: number | string | null;
  collaboration_share_amount: number | string | null;
};

const financeBatchProjectSummarySelect = `
  finance_batch_id,
  project_id,
  receivable_amount,
  streamer_payable_amount,
  project_cost_amount,
  collaboration_share_amount
`;

const FINANCE_BATCH_PROJECT_SUMMARY_PAGE_SIZE = 1000;

const financeBatchSelect = `
  id,
  organization_id,
  batch_type,
  title,
  period_start,
  period_end,
  status,
  has_exceptions,
  system_amount,
  adjustment_amount,
  final_amount,
  item_count,
  exception_count,
  created_by,
  status_reason,
  metadata,
  created_at,
  updated_at
`;

const financeBatchItemSelect = `
  id,
  organization_id,
  finance_batch_id,
  batch_type,
  project_id,
  counterparty_type,
  counterparty_id,
  counterparty_name_snapshot,
  source_type,
  source_id,
  source_snapshot,
  system_amount,
  adjustment_amount,
  final_amount,
  evidence_level,
  evidence_snapshot,
  status,
  exception_flags,
  created_at,
  updated_at
`;

const streamerPayableSourceSelect = `
  id,
  organization_id,
  project_id,
  streamer_id,
  settlement_duration,
  time_source,
  evidence_level,
  created_at,
  projects(name, code),
  streamers(display_name)
`;

export class SupabaseFinanceBatchRepository implements FinanceBatchRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listFinanceBatches(input: {
    organizationId: string;
  }): Promise<FinanceBatchRecord[]> {
    const { data, error } = await this.client
      .from("finance_batches")
      .select(financeBatchSelect)
      .eq("organization_id", input.organizationId)
      .order("created_at", { ascending: false })
      .returns<FinanceBatchRow[]>();

    if (error) {
      throw error;
    }

    return (data ?? []).map(toFinanceBatchRecord);
  }

  async getFinanceBatchDetail(input: {
    organizationId: string;
    financeBatchId: string;
  }): Promise<{
    batch: FinanceBatchRecord;
    items: FinanceBatchItemRecord[];
  } | null> {
    const batch = await this.getFinanceBatch(input);
    if (!batch) {
      return null;
    }

    const { data, error } = await this.client
      .from("finance_batch_items")
      .select(financeBatchItemSelect)
      .eq("organization_id", input.organizationId)
      .eq("finance_batch_id", input.financeBatchId)
      .order("created_at", { ascending: true })
      .returns<FinanceBatchItemRow[]>();

    if (error) {
      throw error;
    }

    return {
      batch,
      items: (data ?? []).map(toFinanceBatchItemRecord),
    };
  }

  async listStreamerPayableSources(input: {
    organizationId: string;
    periodStart: string;
    periodEnd: string;
    projectIds: string[];
    streamerIds: string[];
    sourceIds: string[];
  }): Promise<StreamerPayableSource[]> {
    let query = this.client
      .from("live_reports")
      .select(streamerPayableSourceSelect)
      .eq("organization_id", input.organizationId)
      .eq("status", "approved")
      .eq("enter_settlement_pool", true)
      .gte("created_at", `${input.periodStart}T00:00:00.000Z`)
      .lte("created_at", `${input.periodEnd}T23:59:59.999Z`)
      .order("created_at", { ascending: true });

    if (input.projectIds.length > 0) {
      query = query.in("project_id", input.projectIds);
    }
    if (input.streamerIds.length > 0) {
      query = query.in("streamer_id", input.streamerIds);
    }
    if (input.sourceIds.length > 0) {
      query = query.in("id", input.sourceIds);
    }

    const { data, error } =
      await query.returns<StreamerPayableLiveReportRow[]>();
    if (error) {
      throw error;
    }

    const rows = (data ?? []).filter((row) => row.settlement_duration !== null);
    const consumedSourceIds =
      rows.length > 0
        ? await this.listConsumedStreamerPayableLiveReportIds({
            organizationId: input.organizationId,
            sourceIds: rows.map((row) => row.id),
          })
        : new Set<string>();
    const availableRows = rows.filter((row) => !consumedSourceIds.has(row.id));
    const rulesByPair = await this.listProjectStreamerSettlementRules({
      organizationId: input.organizationId,
      projectIds: uniqueStable(availableRows.map((row) => row.project_id)),
      streamerIds: uniqueStable(availableRows.map((row) => row.streamer_id)),
    });

    return availableRows.map((row) =>
      toStreamerPayableSource(row, rulesByPair),
    );
  }

  async createFinanceBatchAtomic(input: {
    organizationId: string;
    batchType: FinanceBatchType;
    title?: string | null;
    periodStart: string;
    periodEnd: string;
    systemAmount: number;
    adjustmentAmount: number;
    finalAmount: number;
    createdBy: string;
    items: FinanceBatchAtomicItemInput[];
  }): Promise<{
    batch: FinanceBatchRecord;
    items: FinanceBatchItemRecord[];
  }> {
    const { data, error } = await this.client.rpc("create_finance_batch", {
      p_organization_id: input.organizationId,
      p_batch_type: input.batchType,
      p_title: input.title ?? null,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_system_amount: input.systemAmount,
      p_adjustment_amount: input.adjustmentAmount,
      p_final_amount: input.finalAmount,
      p_created_by: input.createdBy,
      p_items: input.items.map(toFinanceBatchItemRpcPayload),
    });

    if (error) {
      throw error;
    }

    const result = data as {
      batch: FinanceBatchRow;
      items?: FinanceBatchItemRow[];
    };

    return {
      batch: toFinanceBatchRecord(result.batch),
      items: (result.items ?? []).map(toFinanceBatchItemRecord),
    };
  }

  async getFinanceBatch(input: {
    organizationId: string;
    financeBatchId: string;
  }): Promise<FinanceBatchRecord | null> {
    const { data, error } = await this.client
      .from("finance_batches")
      .select(financeBatchSelect)
      .eq("organization_id", input.organizationId)
      .eq("id", input.financeBatchId)
      .maybeSingle<FinanceBatchRow>();

    if (error) {
      throw error;
    }

    return data ? toFinanceBatchRecord(data) : null;
  }

  async addAdjustment(input: {
    organizationId: string;
    financeBatchId: string;
    financeBatchItemId: string | null;
    direction: FinanceAdjustmentDirection;
    amount: number;
    reason: string;
    evidenceSnapshot: JsonRecord;
    createdBy: string;
  }): Promise<{
    batch: FinanceBatchRecord;
    adjustment: FinanceBatchAdjustmentRecord;
  }> {
    const { data, error } = await this.client.rpc(
      "add_finance_batch_adjustment",
      {
        p_organization_id: input.organizationId,
        p_finance_batch_id: input.financeBatchId,
        p_finance_batch_item_id: input.financeBatchItemId,
        p_direction: input.direction,
        p_amount: input.amount,
        p_reason: input.reason,
        p_evidence_snapshot: input.evidenceSnapshot,
        p_created_by: input.createdBy,
      },
    );

    if (error) {
      throw error;
    }

    const result = data as {
      batch: FinanceBatchRow;
      adjustment: FinanceBatchAdjustmentRow;
    };

    return {
      batch: toFinanceBatchRecord(result.batch),
      adjustment: toFinanceBatchAdjustmentRecord(result.adjustment),
    };
  }

  async transitionBatch(input: {
    organizationId: string;
    financeBatchId: string;
    nextStatus: FinanceBatchStatus;
    actorUserId: string;
    reason: string | null;
  }): Promise<FinanceBatchRecord> {
    const { data, error } = await this.client.rpc("transition_finance_batch", {
      p_organization_id: input.organizationId,
      p_finance_batch_id: input.financeBatchId,
      p_next_status: input.nextStatus,
      p_actor_user_id: input.actorUserId,
      p_reason: input.reason,
    });

    if (error) {
      throw error;
    }

    const result = data as { batch: FinanceBatchRow };
    return toFinanceBatchRecord(result.batch);
  }

  private async listConsumedStreamerPayableLiveReportIds(input: {
    organizationId: string;
    sourceIds: string[];
  }): Promise<Set<string>> {
    if (input.sourceIds.length === 0) {
      return new Set();
    }

    const [newFinanceConsumedIds, legacyConsumedIds] = await Promise.all([
      this.listNewFinanceConsumedStreamerPayableLiveReportIds(input),
      this.listLegacyConsumedPayableLiveReportIds(input),
    ]);

    return new Set([...newFinanceConsumedIds, ...legacyConsumedIds]);
  }

  private async listNewFinanceConsumedStreamerPayableLiveReportIds(input: {
    organizationId: string;
    sourceIds: string[];
  }): Promise<Set<string>> {
    const { data, error } = await this.client
      .from("finance_batch_items")
      .select("source_id")
      .eq("organization_id", input.organizationId)
      .eq("batch_type", "streamer_payable")
      .eq("source_type", "live_report")
      .eq("status", "active")
      .in("source_id", input.sourceIds)
      .returns<Array<{ source_id: string | null }>>();

    if (error) {
      throw error;
    }

    return new Set(
      (data ?? [])
        .map((row) => row.source_id)
        .filter((sourceId): sourceId is string => Boolean(sourceId)),
    );
  }

  private async listLegacyConsumedPayableLiveReportIds(input: {
    organizationId: string;
    sourceIds: string[];
  }): Promise<Set<string>> {
    const { data, error } = await this.client
      .from("settlement_batch_item_reports")
      .select(
        "live_report_id, settlement_batch_items!inner(organization_id, settlement_batches!inner(batch_type, status))",
      )
      .in("live_report_id", input.sourceIds)
      .returns<LegacyConsumedSettlementBatchItemReportRow[]>();

    if (error) {
      throw error;
    }

    return new Set(
      (data ?? [])
        .filter((row) =>
          hasLegacyPayableSettlementBatch(row, input.organizationId),
        )
        .map((row) => row.live_report_id)
        .filter((sourceId): sourceId is string => Boolean(sourceId)),
    );
  }

  private async listProjectStreamerSettlementRules(input: {
    organizationId: string;
    projectIds: string[];
    streamerIds: string[];
  }): Promise<Map<string, ProjectStreamerSettlementRuleRow>> {
    if (input.projectIds.length === 0 || input.streamerIds.length === 0) {
      return new Map();
    }

    const { data, error } = await this.client
      .from("project_streamers")
      .select(
        "project_id, streamer_id, settlement_method, hourly_rate, base_salary, cps_rate_bps",
      )
      .eq("organization_id", input.organizationId)
      .in("project_id", input.projectIds)
      .in("streamer_id", input.streamerIds)
      .returns<ProjectStreamerSettlementRuleRow[]>();

    if (error) {
      throw error;
    }

    return new Map(
      (data ?? []).map((row) => [
        projectStreamerKey(row.project_id, row.streamer_id),
        row,
      ]),
    );
  }
}

export function toFinanceBatchRecord(row: FinanceBatchRow): FinanceBatchRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    batchType: row.batch_type,
    title: row.title,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    hasExceptions: row.has_exceptions,
    systemAmount: Number(row.system_amount),
    adjustmentAmount: Number(row.adjustment_amount),
    finalAmount: Number(row.final_amount),
    itemCount: row.item_count,
    exceptionCount: row.exception_count,
    createdBy: row.created_by,
    statusReason: row.status_reason,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listOpsFinanceBatches(
  client: SupabaseClient,
  input: { organizationId: string; projectId?: string },
): Promise<OpsReferenceFinanceBatch[]> {
  let financeBatchIds: string[] | null = null;
  const summaryRowsByBatchId = new Map<
    string,
    FinanceBatchProjectSummaryRow[]
  >();

  if (input.projectId) {
    const { data: summaryRows, error: summaryError } = await client
      .from("finance_batch_project_summary")
      .select(financeBatchProjectSummarySelect)
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .order("updated_at", { ascending: false })
      .limit(200)
      .returns<FinanceBatchProjectSummaryRow[]>();

    if (summaryError) {
      throw summaryError;
    }

    financeBatchIds = uniqueStable(
      (summaryRows ?? [])
        .map((row) => row.finance_batch_id)
        .filter((id): id is string => Boolean(id)),
    );
    for (const row of summaryRows ?? []) {
      if (row.finance_batch_id) {
        const current = summaryRowsByBatchId.get(row.finance_batch_id) ?? [];
        current.push(row);
        summaryRowsByBatchId.set(row.finance_batch_id, current);
      }
    }

    if (financeBatchIds.length === 0) {
      return [];
    }
  }

  let query = client
    .from("finance_batches")
    .select(financeBatchSelect)
    .eq("organization_id", input.organizationId)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (financeBatchIds) {
    query = query.in("id", financeBatchIds);
  }

  const { data, error } = await query.returns<FinanceBatchRow[]>();

  if (error) {
    throw error;
  }

  if (!input.projectId) {
    const returnedBatchIds = uniqueStable(
      (data ?? []).map((row) => row.id).filter(Boolean),
    );
    if (returnedBatchIds.length > 0) {
      const summaryRows = await listFinanceBatchProjectSummaryRows(client, {
        organizationId: input.organizationId,
        financeBatchIds: returnedBatchIds,
      });
      for (const row of summaryRows) {
        if (row.finance_batch_id) {
          const current = summaryRowsByBatchId.get(row.finance_batch_id) ?? [];
          current.push(row);
          summaryRowsByBatchId.set(row.finance_batch_id, current);
        }
      }
    }
  }

  return (data ?? [])
    .map((row) => toFinanceBatchRecord(row))
    .map((batch) => {
      const mapped = toOpsReferenceFinanceBatch(batch);
      const summaryRows = summaryRowsByBatchId.get(batch.id) ?? [];
      if (summaryRows.length === 0) {
        return mapped;
      }
      const projectAmountById = financeBatchProjectAmountById(
        batch.batchType,
        summaryRows,
      );
      const projectIds = uniqueStable(Object.keys(projectAmountById));
      if (projectIds.length === 0) {
        return mapped;
      }
      if (!input.projectId) {
        return {
          ...mapped,
          projectIds,
          projectAmountById,
        };
      }
      const projectId = input.projectId;
      const projectAmount = projectAmountById[projectId];
      return {
        ...mapped,
        projectId,
        projectIds,
        projectAmount,
        finalProjectAmount: projectAmount,
        projectAmountById,
      };
    });
}

async function listFinanceBatchProjectSummaryRows(
  client: SupabaseClient,
  input: { organizationId: string; financeBatchIds: string[] },
): Promise<FinanceBatchProjectSummaryRow[]> {
  const rows: FinanceBatchProjectSummaryRow[] = [];
  for (let offset = 0; ; offset += FINANCE_BATCH_PROJECT_SUMMARY_PAGE_SIZE) {
    const { data, error } = await client
      .from("finance_batch_project_summary")
      .select(financeBatchProjectSummarySelect)
      .eq("organization_id", input.organizationId)
      .in("finance_batch_id", input.financeBatchIds)
      .order("finance_batch_id", { ascending: true })
      .order("project_id", { ascending: true })
      .range(offset, offset + FINANCE_BATCH_PROJECT_SUMMARY_PAGE_SIZE - 1)
      .returns<FinanceBatchProjectSummaryRow[]>();

    if (error) {
      throw error;
    }

    const page = data ?? [];
    rows.push(...page);
    if (page.length < FINANCE_BATCH_PROJECT_SUMMARY_PAGE_SIZE) {
      return rows;
    }
  }
}

function financeBatchProjectAmountById(
  batchType: FinanceBatchType,
  rows: FinanceBatchProjectSummaryRow[],
): Record<string, number> {
  const amountById: Record<string, number> = {};
  for (const row of rows) {
    if (!row.project_id || row.project_id in amountById) {
      continue;
    }
    amountById[row.project_id] = financeBatchProjectAmount(batchType, row);
  }
  return amountById;
}

function financeBatchProjectAmount(
  batchType: FinanceBatchType,
  row: FinanceBatchProjectSummaryRow,
): number {
  const amountByType: Record<FinanceBatchType, number | string | null> = {
    receivable: row.receivable_amount,
    streamer_payable: row.streamer_payable_amount,
    project_cost: row.project_cost_amount,
    collaboration_share: row.collaboration_share_amount,
  };
  const amount = Number(amountByType[batchType] ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function toFinanceBatchItemRecord(
  row: FinanceBatchItemRow,
): FinanceBatchItemRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    financeBatchId: row.finance_batch_id,
    batchType: row.batch_type,
    projectId: row.project_id,
    counterpartyType: row.counterparty_type,
    counterpartyId: row.counterparty_id,
    counterpartyNameSnapshot: row.counterparty_name_snapshot,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceSnapshot: row.source_snapshot ?? {},
    systemAmount: Number(row.system_amount),
    adjustmentAmount: Number(row.adjustment_amount),
    finalAmount: Number(row.final_amount),
    evidenceLevel: row.evidence_level,
    evidenceSnapshot: row.evidence_snapshot ?? {},
    status: row.status,
    exceptionFlags: row.exception_flags ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toFinanceBatchAdjustmentRecord(
  row: FinanceBatchAdjustmentRow,
): FinanceBatchAdjustmentRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    financeBatchId: row.finance_batch_id,
    financeBatchItemId: row.finance_batch_item_id,
    direction: row.direction,
    amount: Number(row.amount),
    reason: row.reason,
    evidenceSnapshot: row.evidence_snapshot ?? {},
    createdBy: row.created_by,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
  };
}

function toFinanceBatchItemRpcPayload(
  item: FinanceBatchAtomicItemInput,
): Record<string, unknown> {
  return {
    project_id: item.projectId,
    counterparty_type: item.counterpartyType,
    counterparty_id: item.counterpartyId,
    counterparty_name_snapshot: item.counterpartyNameSnapshot,
    source_type: item.sourceType,
    source_id: item.sourceId,
    source_snapshot: item.sourceSnapshot,
    system_amount: item.systemAmount,
    adjustment_amount: item.adjustmentAmount,
    final_amount: item.finalAmount,
    evidence_level: item.evidenceLevel,
    evidence_snapshot: item.evidenceSnapshot,
    exception_flags: item.exceptionFlags,
  };
}

function toStreamerPayableSource(
  row: StreamerPayableLiveReportRow,
  rulesByPair: Map<string, ProjectStreamerSettlementRuleRow>,
): StreamerPayableSource {
  const project = firstRelation(row.projects);
  const streamer = firstRelation(row.streamers);
  const rule = rulesByPair.get(
    projectStreamerKey(row.project_id, row.streamer_id),
  );

  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    projectName: project?.name ?? null,
    projectCode: project?.code ?? null,
    streamerId: row.streamer_id,
    streamerName: streamer?.display_name ?? null,
    settlementDuration: row.settlement_duration ?? 0,
    timeSource: row.time_source,
    evidenceLevel: row.evidence_level,
    createdAt: row.created_at,
    settlementMethod: rule?.settlement_method ?? "cpt",
    hourlyRate: Number(rule?.hourly_rate ?? 0),
    baseSalary: Number(rule?.base_salary ?? 0),
    cpsRateBps: Number(rule?.cps_rate_bps ?? 0),
  };
}

function hasLegacyPayableSettlementBatch(
  row: LegacyConsumedSettlementBatchItemReportRow,
  organizationId: string,
): boolean {
  const item = firstRelation(row.settlement_batch_items);
  if (!item || item.organization_id !== organizationId) {
    return false;
  }

  const batch = firstRelation(item.settlement_batches);
  return batch?.batch_type === "payable" && batch.status !== "voided";
}

function firstRelation<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) {
    return null;
  }
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

function projectStreamerKey(projectId: string, streamerId: string): string {
  return `${projectId}:${streamerId}`;
}

function uniqueStable(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
