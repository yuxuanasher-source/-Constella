import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CollaborationLite,
  CollaborationSettlementRecord,
  SettlementBatchLite,
  SettlementLineItemRecord,
  SettlementLineRepository,
} from "./settlement-line-service";
import type {
  CollaborationSplitMode,
  SettlementLineDirection,
} from "./settlement-margin-engine";

type LineItemRow = {
  id: string;
  settlement_batch_id: string;
  project_id: string;
  streamer_id: string | null;
  direction: SettlementLineDirection;
  category: string;
  label: string;
  amount: number;
  is_system_generated: boolean;
};

type CollaborationSettlementRow = {
  id: string;
  settlement_batch_id: string;
  collaboration_id: string;
  project_id: string;
  mode: CollaborationSplitMode;
  share_percentage: number | null;
  hourly_fixed_amount: number | null;
  basis_amount: number;
  total_hours: number | null;
  computed_amount: number;
  manual_amount: number;
};

const lineItemSelect =
  "id, settlement_batch_id, project_id, streamer_id, direction, category, label, amount, is_system_generated";

const collaborationSettlementSelect =
  "id, settlement_batch_id, collaboration_id, project_id, mode, share_percentage, hourly_fixed_amount, basis_amount, total_hours, computed_amount, manual_amount";

export class SupabaseSettlementLineRepository
  implements SettlementLineRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async getBatch(batchId: string): Promise<SettlementBatchLite | null> {
    const { data, error } = await this.client
      .from("settlement_batches")
      .select("id, project_id, organization_id, status")
      .eq("id", batchId)
      .maybeSingle<{
        id: string;
        project_id: string;
        organization_id: string;
        status: string;
      }>();

    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }

    return {
      id: data.id,
      projectId: data.project_id,
      organizationId: data.organization_id,
      status: data.status,
    };
  }

  async listLineItems(batchId: string): Promise<SettlementLineItemRecord[]> {
    const { data, error } = await this.client
      .from("settlement_line_items")
      .select(lineItemSelect)
      .eq("settlement_batch_id", batchId)
      .order("created_at", { ascending: true })
      .returns<LineItemRow[]>();

    if (error) {
      throw error;
    }

    return (data ?? []).map(toLineItemRecord);
  }

  async createLineItem(input: {
    organizationId: string;
    settlementBatchId: string;
    projectId: string;
    streamerId: string | null;
    direction: SettlementLineDirection;
    category: string;
    label: string;
    amount: number;
    reason: string;
    createdBy: string;
  }): Promise<SettlementLineItemRecord> {
    const { data, error } = await this.client
      .from("settlement_line_items")
      .insert({
        organization_id: input.organizationId,
        settlement_batch_id: input.settlementBatchId,
        project_id: input.projectId,
        streamer_id: input.streamerId,
        direction: input.direction,
        category: input.category,
        label: input.label,
        amount: input.amount,
        is_system_generated: false,
        reason: input.reason,
        created_by: input.createdBy,
      })
      .select(lineItemSelect)
      .single<LineItemRow>();

    if (error) {
      throw error;
    }

    return toLineItemRecord(data);
  }

  async getLineItemById(
    lineItemId: string,
  ): Promise<SettlementLineItemRecord | null> {
    const { data, error } = await this.client
      .from("settlement_line_items")
      .select(lineItemSelect)
      .eq("id", lineItemId)
      .maybeSingle<LineItemRow>();

    if (error) {
      throw error;
    }

    return data ? toLineItemRecord(data) : null;
  }

  async updateLineItem(
    lineItemId: string,
    patch: Record<string, unknown>,
  ): Promise<SettlementLineItemRecord> {
    const { data, error } = await this.client
      .from("settlement_line_items")
      .update(patch)
      .eq("id", lineItemId)
      .select(lineItemSelect)
      .single<LineItemRow>();

    if (error) {
      throw error;
    }

    return toLineItemRecord(data);
  }

  async deleteLineItem(lineItemId: string): Promise<void> {
    const { error } = await this.client
      .from("settlement_line_items")
      .delete()
      .eq("id", lineItemId);

    if (error) {
      throw error;
    }
  }

  async getCollaboration(
    collaborationId: string,
  ): Promise<CollaborationLite | null> {
    const { data, error } = await this.client
      .from("project_collaborations")
      .select(
        "id, project_id, settlement_mode, share_percentage, hourly_fixed_amount",
      )
      .eq("id", collaborationId)
      .maybeSingle<{
        id: string;
        project_id: string;
        settlement_mode: CollaborationSplitMode;
        share_percentage: number | null;
        hourly_fixed_amount: number | null;
      }>();

    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }

    return {
      id: data.id,
      projectId: data.project_id,
      mode: data.settlement_mode,
      sharePercentage: data.share_percentage,
      hourlyFixedAmount: data.hourly_fixed_amount,
    };
  }

  async getBatchTotalHours(batchId: string): Promise<number> {
    const { data, error } = await this.client
      .from("settlement_batch_items")
      .select("evidence_snapshot")
      .eq("settlement_batch_id", batchId)
      .returns<{ evidence_snapshot: Record<string, unknown> }[]>();

    if (error) {
      throw error;
    }

    const totalMinutes = (data ?? []).reduce((sum, row) => {
      const duration = Number(row.evidence_snapshot?.settlementDuration ?? 0);
      return sum + (Number.isFinite(duration) ? duration : 0);
    }, 0);

    return Math.round((totalMinutes / 60) * 100) / 100;
  }

  async listCollaborationSettlements(
    batchId: string,
  ): Promise<CollaborationSettlementRecord[]> {
    const { data, error } = await this.client
      .from("collaboration_settlements")
      .select(collaborationSettlementSelect)
      .eq("settlement_batch_id", batchId)
      .returns<CollaborationSettlementRow[]>();

    if (error) {
      throw error;
    }

    return (data ?? []).map(toCollaborationSettlementRecord);
  }

  async upsertCollaborationSettlement(input: {
    organizationId: string;
    settlementBatchId: string;
    collaborationId: string;
    projectId: string;
    mode: CollaborationSplitMode;
    sharePercentage: number | null;
    hourlyFixedAmount: number | null;
    basisAmount: number;
    totalHours: number | null;
    computedAmount: number;
    createdBy: string;
  }): Promise<CollaborationSettlementRecord> {
    const { data, error } = await this.client
      .from("collaboration_settlements")
      .upsert(
        {
          organization_id: input.organizationId,
          settlement_batch_id: input.settlementBatchId,
          collaboration_id: input.collaborationId,
          project_id: input.projectId,
          mode: input.mode,
          share_percentage: input.sharePercentage,
          hourly_fixed_amount: input.hourlyFixedAmount,
          basis_amount: input.basisAmount,
          total_hours: input.totalHours,
          computed_amount: input.computedAmount,
          created_by: input.createdBy,
        },
        { onConflict: "settlement_batch_id,collaboration_id" },
      )
      .select(collaborationSettlementSelect)
      .single<CollaborationSettlementRow>();

    if (error) {
      throw error;
    }

    return toCollaborationSettlementRecord(data);
  }
}

function toLineItemRecord(row: LineItemRow): SettlementLineItemRecord {
  return {
    id: row.id,
    settlementBatchId: row.settlement_batch_id,
    projectId: row.project_id,
    streamerId: row.streamer_id,
    direction: row.direction,
    category: row.category,
    label: row.label,
    amount: Number(row.amount),
    isSystemGenerated: row.is_system_generated,
  };
}

function toCollaborationSettlementRecord(
  row: CollaborationSettlementRow,
): CollaborationSettlementRecord {
  return {
    id: row.id,
    settlementBatchId: row.settlement_batch_id,
    collaborationId: row.collaboration_id,
    projectId: row.project_id,
    mode: row.mode,
    sharePercentage: row.share_percentage,
    hourlyFixedAmount: row.hourly_fixed_amount,
    basisAmount: Number(row.basis_amount),
    totalHours: row.total_hours === null ? null : Number(row.total_hours),
    computedAmount: Number(row.computed_amount),
    manualAmount: Number(row.manual_amount),
  };
}
