import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  SettlementBatchAtomicItemInput,
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
import type {
  ProjectStreamerSettlementPatch,
  ProjectStreamerSettlementRecord,
} from "./project-streamer-settlement-service";
import { extractStructuredSettlementRule } from "./structured-settlement-rule";

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

type SettlementBatchItemStateRow = {
  live_report_id: string | null;
  settlement_batches:
    | { batch_type: SettlementBatchType }
    | Array<{ batch_type: SettlementBatchType }>
    | null;
};

type SettlementRuleRow = {
  project_id: string;
  streamer_id: string;
  settlement_method: SettlementMethod | null;
  hourly_rate: number | null;
  base_salary: number | null;
  cps_rate_bps: number | null;
};

type ProjectSettlementRuleRow = {
  id: string;
  default_settlement_method: SettlementMethod;
  default_hourly_rate: number;
  default_base_salary: number;
  default_settlement_rule?: unknown;
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
    batchType: SettlementBatchType;
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
      .gte("created_at", `${input.periodStart}T00:00:00.000Z`)
      .lte("created_at", `${input.periodEnd}T23:59:59.999Z`)
      .order("created_at", { ascending: true })
      .returns<SettlementPoolReportRow[]>();

    if (error) {
      throw error;
    }

    const rows = data ?? [];
    const reportIds = rows.map((row) => row.id);
    const settledReportIds = reportIds.length
      ? await this.listSettledReportIdsForBatchType(reportIds, input.batchType)
      : new Set<string>();

    return rows
      .filter((row) => !settledReportIds.has(row.id))
      .map((row) => toSettlementPoolReport(row, []));
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
        "project_id, streamer_id, settlement_method, hourly_rate, base_salary, cps_rate_bps",
      )
      .eq("project_id", input.projectId)
      .in("streamer_id", input.streamerIds)
      .returns<SettlementRuleRow[]>();

    if (error) {
      throw error;
    }

    // The project-level structured rule (tiers / penalties / floor / cap)
    // applies on top of each streamer's flat method + rate columns.
    const projectRule = await this.getProjectSettlementRule({
      projectId: input.projectId,
    });
    const structured = projectRule
      ? extractStructuredSettlementRule({
          hourlyTiers: projectRule.hourlyTiers,
          penalties: projectRule.penalties,
          floorAmount: projectRule.floorAmount,
          capAmount: projectRule.capAmount,
        })
      : {};

    return (data ?? []).map((row) => ({
      ...toSettlementRuleRecord(row),
      ...structured,
    }));
  }

  async getProjectSettlementRule(input: {
    projectId: string;
  }): Promise<ProjectSettlementRuleRecord | null> {
    const { data, error } = await this.client
      .from("projects")
      .select(
        "id, default_settlement_method, default_hourly_rate, default_base_salary, default_settlement_rule",
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

  async createSettlementBatchAtomic(input: {
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
    items: SettlementBatchAtomicItemInput[];
  }): Promise<{
    batch: SettlementBatchRecord;
    items: SettlementBatchItemRecord[];
  }> {
    const { data, error } = await this.client.rpc("generate_settlement_batch", {
      p_organization_id: input.organizationId,
      p_project_id: input.projectId,
      p_batch_type: input.batchType,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_computed_amount: input.computedAmount,
      p_manual_amount: input.manualAmount,
      p_adjustment_amount: input.adjustmentAmount,
      p_evidence_summary: input.evidenceSummary,
      p_created_by: input.createdBy,
      p_items: input.items.map((item) => ({
        streamer_id: item.streamerId ?? null,
        live_report_id: item.liveReportId ?? null,
        item_type: item.itemType,
        computed_amount: item.computedAmount,
        manual_amount: item.manualAmount,
        adjustment_amount: item.adjustmentAmount,
        evidence_level: item.evidenceLevel ?? null,
        evidence_snapshot: item.evidenceSnapshot,
      })),
    });

    if (error) {
      throw error;
    }

    const result = data as {
      batch: SettlementBatchRow;
      items: SettlementBatchItemRow[];
    };
    return {
      batch: toSettlementBatchRecord(result.batch),
      items: (result.items ?? []).map(toSettlementBatchItemRecord),
    };
  }

  async markReportSettled(input: {
    reportId: string;
    settlementBatchItemId: string;
    batchType: SettlementBatchType;
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

  private async listSettledReportIdsForBatchType(
    reportIds: string[],
    batchType: SettlementBatchType,
  ): Promise<Set<string>> {
    const { data, error } = await this.client
      .from("settlement_batch_items")
      .select("live_report_id, settlement_batches!inner(batch_type)")
      .in("live_report_id", reportIds)
      .eq("settlement_batches.batch_type", batchType)
      .returns<SettlementBatchItemStateRow[]>();

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

  async getProjectStreamerSettlement(input: {
    organizationId: string;
    projectId: string;
    streamerId: string;
  }): Promise<ProjectStreamerSettlementRecord | null> {
    const { data, error } = await this.client
      .from("project_streamers")
      .select(projectStreamerSettlementSelect)
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .eq("streamer_id", input.streamerId)
      .maybeSingle<ProjectStreamerSettlementRow>();

    if (error) {
      throw error;
    }

    return data ? toProjectStreamerSettlementRecord(data) : null;
  }

  async updateProjectStreamerSettlementRule(input: {
    organizationId: string;
    projectId: string;
    streamerId: string;
    patch: ProjectStreamerSettlementPatch;
  }): Promise<ProjectStreamerSettlementRecord> {
    const { data, error } = await this.client
      .from("project_streamers")
      .update(input.patch)
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .eq("streamer_id", input.streamerId)
      .select(projectStreamerSettlementSelect)
      .single<ProjectStreamerSettlementRow>();

    if (error) {
      throw error;
    }

    return toProjectStreamerSettlementRecord(data);
  }
}

const projectStreamerSettlementSelect =
  "id, project_id, streamer_id, settlement_method, hourly_rate, base_salary, cps_rate_bps, streamers(display_name)";

type ProjectStreamerSettlementRow = {
  id: string;
  project_id: string;
  streamer_id: string;
  settlement_method: SettlementMethod | null;
  hourly_rate: number | null;
  base_salary: number | null;
  cps_rate_bps: number | null;
  streamers?:
    | { display_name: string | null }
    | Array<{ display_name: string | null }>
    | null;
};

function toProjectStreamerSettlementRecord(
  row: ProjectStreamerSettlementRow,
): ProjectStreamerSettlementRecord {
  const streamer = Array.isArray(row.streamers)
    ? row.streamers[0]
    : row.streamers;
  return {
    id: row.id,
    projectId: row.project_id,
    streamerId: row.streamer_id,
    streamerName: streamer?.display_name ?? null,
    settlementMethod: row.settlement_method,
    hourlyRate: row.hourly_rate,
    baseSalary: row.base_salary,
    cpsRateBps: row.cps_rate_bps,
  };
}

function toSettlementPoolReport(
  row: SettlementPoolReportRow,
  settledBatchTypes: SettlementBatchType[] = [],
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
    settledBatchTypes,
    createdAt: row.created_at,
  };
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

function toSettlementRuleRecord(row: SettlementRuleRow): SettlementRuleRecord {
  return {
    projectId: row.project_id,
    streamerId: row.streamer_id,
    settlementMethod: row.settlement_method ?? "manual",
    hourlyRate: Number(row.hourly_rate ?? 0),
    baseSalary: Number(row.base_salary ?? 0),
    cpsRateBps: Number(row.cps_rate_bps ?? 0),
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
    ...extractStructuredSettlementRule(row.default_settlement_rule),
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
