import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  SettlementBatchItemRecord,
  SettlementBatchRecord,
  SettlementBatchStatus,
  SettlementBatchType,
  ProjectSettlementRuleRecord,
  SettlementPoolReport,
  SettlementRepository,
  SettlementRuleRecord,
} from "./settlement-service";
import type { SettlementMethod } from "./settlement-engine";

type SettlementPoolReportRow = {
  id: string;
  organization_id: string;
  project_id: string;
  streamer_id: string;
  live_task_id: string;
  status: "approved";
  settlement_duration: number | null;
  time_source: "system" | "screenshot" | "claimed" | null;
  evidence_level: "green" | "yellow" | "red" | null;
  settled_batch_item_id: string | null;
  created_at: string;
};

type SettlementRuleRow = {
  project_id: string;
  streamer_id: string;
  settlement_method: SettlementMethod | null;
  hourly_rate: number | null;
  base_salary: number | null;
};

type ProjectSettlementRuleRow = {
  id: string;
  default_settlement_method: SettlementMethod;
  default_hourly_rate: number;
  default_base_salary: number;
};

type SettlementBatchRow = {
  id: string;
  organization_id: string;
  project_id: string;
  batch_type: SettlementBatchType;
  status: SettlementBatchStatus;
  period_start: string;
  period_end: string;
  computed_amount: number;
  manual_amount: number;
  adjustment_amount: number;
  evidence_summary: Record<string, unknown>;
  lock_reason: string | null;
  reopen_reason: string | null;
  created_by: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
};

type SettlementBatchItemRow = {
  id: string;
  organization_id: string;
  settlement_batch_id: string;
  project_id: string;
  streamer_id: string | null;
  live_report_id: string | null;
  item_type: string;
  computed_amount: number;
  manual_amount: number;
  adjustment_amount: number;
  evidence_level: "green" | "yellow" | "red" | null;
  evidence_snapshot: Record<string, unknown>;
  created_at: string;
};

const settlementPoolReportSelect = `
  id,
  organization_id,
  project_id,
  streamer_id,
  live_task_id,
  status,
  settlement_duration,
  time_source,
  evidence_level,
  settled_batch_item_id,
  created_at
`;

const settlementBatchSelect = `
  id,
  organization_id,
  project_id,
  batch_type,
  status,
  period_start,
  period_end,
  computed_amount,
  manual_amount,
  adjustment_amount,
  evidence_summary,
  lock_reason,
  reopen_reason,
  created_by,
  locked_at,
  created_at,
  updated_at
`;

const settlementBatchItemSelect = `
  id,
  organization_id,
  settlement_batch_id,
  project_id,
  streamer_id,
  live_report_id,
  item_type,
  computed_amount,
  manual_amount,
  adjustment_amount,
  evidence_level,
  evidence_snapshot,
  created_at
`;

export class SupabaseSettlementRepository implements SettlementRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listSettlementPoolReports(input: {
    organizationId: string;
    projectId: string;
    periodStart: string;
    periodEnd: string;
  }): Promise<SettlementPoolReport[]> {
    const { data, error } = await this.client
      .from("live_reports")
      .select(settlementPoolReportSelect)
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .eq("status", "approved")
      .eq("enter_settlement_pool", true)
      .is("settled_batch_item_id", null)
      .gte("created_at", `${input.periodStart}T00:00:00.000Z`)
      .lte("created_at", `${input.periodEnd}T23:59:59.999Z`)
      .order("created_at", { ascending: true })
      .returns<SettlementPoolReportRow[]>();

    if (error) {
      throw error;
    }

    return (data ?? []).map(toSettlementPoolReport);
  }

  async getSettlementRules(input: {
    projectId: string;
    streamerIds: string[];
  }): Promise<SettlementRuleRecord[]> {
    if (input.streamerIds.length === 0) {
      return [];
    }

    const { data, error } = await this.client
      .from("project_streamers")
      .select(
        "project_id, streamer_id, settlement_method, hourly_rate, base_salary",
      )
      .eq("project_id", input.projectId)
      .in("streamer_id", input.streamerIds)
      .returns<SettlementRuleRow[]>();

    if (error) {
      throw error;
    }

    return (data ?? []).map(toSettlementRuleRecord);
  }

  async getProjectSettlementRule(input: {
    projectId: string;
  }): Promise<ProjectSettlementRuleRecord | null> {
    const { data, error } = await this.client
      .from("projects")
      .select(
        "id, default_settlement_method, default_hourly_rate, default_base_salary",
      )
      .eq("id", input.projectId)
      .maybeSingle<ProjectSettlementRuleRow>();

    if (error) {
      throw error;
    }

    return data ? toProjectSettlementRuleRecord(data) : null;
  }

  async createSettlementBatch(input: {
    organizationId: string;
    projectId: string;
    batchType: SettlementBatchType;
    periodStart: string;
    periodEnd: string;
    computedAmount: number;
    manualAmount: number;
    adjustmentAmount: number;
    evidenceSummary: Record<string, unknown>;
    createdBy: string;
  }): Promise<SettlementBatchRecord> {
    const { data, error } = await this.client
      .from("settlement_batches")
      .insert({
        organization_id: input.organizationId,
        project_id: input.projectId,
        batch_type: input.batchType,
        status: "generated",
        period_start: input.periodStart,
        period_end: input.periodEnd,
        computed_amount: input.computedAmount,
        manual_amount: input.manualAmount,
        adjustment_amount: input.adjustmentAmount,
        evidence_summary: input.evidenceSummary,
        created_by: input.createdBy,
      })
      .select(settlementBatchSelect)
      .single<SettlementBatchRow>();

    if (error) {
      throw error;
    }

    return toSettlementBatchRecord(data);
  }

  async createSettlementBatchItem(
    input: Omit<SettlementBatchItemRecord, "id" | "createdAt">,
  ): Promise<SettlementBatchItemRecord> {
    const { data, error } = await this.client
      .from("settlement_batch_items")
      .insert({
        organization_id: input.organizationId,
        settlement_batch_id: input.settlementBatchId,
        project_id: input.projectId,
        streamer_id: input.streamerId,
        live_report_id: input.liveReportId,
        item_type: input.itemType,
        computed_amount: input.computedAmount,
        manual_amount: input.manualAmount,
        adjustment_amount: input.adjustmentAmount,
        evidence_level: input.evidenceLevel,
        evidence_snapshot: input.evidenceSnapshot,
      })
      .select(settlementBatchItemSelect)
      .single<SettlementBatchItemRow>();

    if (error) {
      throw error;
    }

    return toSettlementBatchItemRecord(data);
  }

  async markReportSettled(input: {
    reportId: string;
    settlementBatchItemId: string;
  }): Promise<void> {
    const { error } = await this.client
      .from("live_reports")
      .update({ settled_batch_item_id: input.settlementBatchItemId })
      .eq("id", input.reportId)
      .is("settled_batch_item_id", null);

    if (error) {
      throw error;
    }
  }

  async getSettlementBatchById(
    batchId: string,
  ): Promise<SettlementBatchRecord | null> {
    const { data, error } = await this.client
      .from("settlement_batches")
      .select(settlementBatchSelect)
      .eq("id", batchId)
      .maybeSingle<SettlementBatchRow>();

    if (error) {
      throw error;
    }

    return data ? toSettlementBatchRecord(data) : null;
  }

  async updateSettlementBatch(
    batchId: string,
    patch: Partial<SettlementBatchRecord>,
  ): Promise<SettlementBatchRecord> {
    const { data, error } = await this.client
      .from("settlement_batches")
      .update(toSettlementBatchPatch(patch))
      .eq("id", batchId)
      .select(settlementBatchSelect)
      .single<SettlementBatchRow>();

    if (error) {
      throw error;
    }

    return toSettlementBatchRecord(data);
  }
}

function toSettlementPoolReport(
  row: SettlementPoolReportRow,
): SettlementPoolReport {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    streamerId: row.streamer_id,
    liveTaskId: row.live_task_id,
    status: row.status,
    settlementDuration: row.settlement_duration,
    timeSource: row.time_source,
    evidenceLevel: row.evidence_level,
    settledBatchItemId: row.settled_batch_item_id,
    createdAt: row.created_at,
  };
}

function toSettlementRuleRecord(row: SettlementRuleRow): SettlementRuleRecord {
  return {
    projectId: row.project_id,
    streamerId: row.streamer_id,
    settlementMethod: row.settlement_method ?? "manual",
    hourlyRate: Number(row.hourly_rate ?? 0),
    baseSalary: Number(row.base_salary ?? 0),
  };
}

function toProjectSettlementRuleRecord(
  row: ProjectSettlementRuleRow,
): ProjectSettlementRuleRecord {
  return {
    projectId: row.id,
    settlementMethod: row.default_settlement_method,
    hourlyRate: Number(row.default_hourly_rate ?? 0),
    baseSalary: Number(row.default_base_salary ?? 0),
  };
}

function toSettlementBatchRecord(
  row: SettlementBatchRow,
): SettlementBatchRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    batchType: row.batch_type,
    status: row.status,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    computedAmount: Number(row.computed_amount),
    manualAmount: Number(row.manual_amount),
    adjustmentAmount: Number(row.adjustment_amount),
    evidenceSummary: row.evidence_summary,
    lockReason: row.lock_reason,
    reopenReason: row.reopen_reason,
    createdBy: row.created_by,
    lockedAt: row.locked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSettlementBatchItemRecord(
  row: SettlementBatchItemRow,
): SettlementBatchItemRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    settlementBatchId: row.settlement_batch_id,
    projectId: row.project_id,
    streamerId: row.streamer_id,
    liveReportId: row.live_report_id,
    itemType: row.item_type,
    computedAmount: Number(row.computed_amount),
    manualAmount: Number(row.manual_amount),
    adjustmentAmount: Number(row.adjustment_amount),
    evidenceLevel: row.evidence_level,
    evidenceSnapshot: row.evidence_snapshot,
    createdAt: row.created_at,
  };
}

function toSettlementBatchPatch(
  patch: Partial<SettlementBatchRecord>,
): Record<string, unknown> {
  return removeUndefined({
    status: patch.status,
    computed_amount: patch.computedAmount,
    manual_amount: patch.manualAmount,
    adjustment_amount: patch.adjustmentAmount,
    evidence_summary: patch.evidenceSummary,
    lock_reason: patch.lockReason,
    reopen_reason: patch.reopenReason,
    locked_at: patch.lockedAt,
  });
}

function removeUndefined(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}
