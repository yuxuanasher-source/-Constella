import type { SupabaseClient } from "@supabase/supabase-js";

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
  evidence_level: string | null;
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

type ProjectStreamerHourlyRateRow = {
  project_id: string;
  streamer_id: string;
  hourly_rate: number | string | null;
};

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

const streamerPayableSourceSelect = `
  id,
  organization_id,
  project_id,
  streamer_id,
  settlement_duration,
  evidence_level,
  created_at,
  projects(name, code),
  streamers(display_name)
`;

export class SupabaseFinanceBatchRepository
  implements FinanceBatchRepository
{
  constructor(private readonly client: SupabaseClient) {}

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

    const { data, error } = await query.returns<StreamerPayableLiveReportRow[]>();
    if (error) {
      throw error;
    }

    const rows = data ?? [];
    const consumedSourceIds =
      rows.length > 0
        ? await this.listConsumedStreamerPayableLiveReportIds({
            organizationId: input.organizationId,
            sourceIds: rows.map((row) => row.id),
          })
        : new Set<string>();
    const availableRows = rows.filter((row) => !consumedSourceIds.has(row.id));
    const hourlyRatesByPair = await this.listProjectStreamerHourlyRates({
      organizationId: input.organizationId,
      projectIds: uniqueStable(availableRows.map((row) => row.project_id)),
      streamerIds: uniqueStable(availableRows.map((row) => row.streamer_id)),
    });

    return availableRows.map((row) =>
      toStreamerPayableSource(row, hourlyRatesByPair),
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

  private async listProjectStreamerHourlyRates(input: {
    organizationId: string;
    projectIds: string[];
    streamerIds: string[];
  }): Promise<Map<string, number>> {
    if (input.projectIds.length === 0 || input.streamerIds.length === 0) {
      return new Map();
    }

    const { data, error } = await this.client
      .from("project_streamers")
      .select("project_id, streamer_id, hourly_rate")
      .eq("organization_id", input.organizationId)
      .in("project_id", input.projectIds)
      .in("streamer_id", input.streamerIds)
      .returns<ProjectStreamerHourlyRateRow[]>();

    if (error) {
      throw error;
    }

    return new Map(
      (data ?? []).map((row) => [
        projectStreamerKey(row.project_id, row.streamer_id),
        Number(row.hourly_rate ?? 0),
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
  hourlyRatesByPair: Map<string, number>,
): StreamerPayableSource {
  const project = firstRelation(row.projects);
  const streamer = firstRelation(row.streamers);

  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    projectName: project?.name ?? null,
    projectCode: project?.code ?? null,
    streamerId: row.streamer_id,
    streamerName: streamer?.display_name ?? null,
    settlementDuration: row.settlement_duration ?? 0,
    evidenceLevel: row.evidence_level,
    createdAt: row.created_at,
    hourlyRate:
      hourlyRatesByPair.get(projectStreamerKey(row.project_id, row.streamer_id)) ??
      0,
  };
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
