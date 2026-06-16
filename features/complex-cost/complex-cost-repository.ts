import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ComplexCostRepository,
  CreateImportBatchRepoInput,
  CreateProjectCostItemRepoInput,
  CreateRuleVersionRepoInput,
} from "./complex-cost-service";
import type {
  ComplexCostRuleStatus,
  ComplexCostRuleVersionRecord,
  ProjectComplexCostEntitlementRecord,
  ProjectCostImportBatchRecord,
  ProjectCostImportStatus,
  ProjectCostImportType,
  ProjectCostItemDirection,
  ProjectCostItemRecord,
  ProjectCostItemSource,
  ProjectCostItemStatus,
  ProjectCostItemType,
  ComplexCostEvidenceLevel,
} from "./complex-cost-types";

type EntitlementRow = {
  id: string;
  organization_id: string;
  project_id: string;
  enabled_source: "plan" | "addon" | "override";
  billing_mode: "included" | "per_project_monthly" | "enterprise";
  valid_from: string;
  valid_to: string | null;
  monthly_price_cents: number;
  created_by: string | null;
  reason: string;
  created_at: string;
};

type RuleVersionRow = {
  id: string;
  organization_id: string;
  project_id: string;
  version_no: number;
  status: ComplexCostRuleStatus;
  rule_payload: Record<string, unknown>;
  created_by: string | null;
  approved_by: string | null;
  effective_from: string | null;
  created_at: string;
};

type CostItemRow = {
  id: string;
  organization_id: string;
  project_id: string;
  streamer_id: string | null;
  supplier_organization_id: string | null;
  live_report_id: string | null;
  settlement_batch_id: string | null;
  item_type: ProjectCostItemType;
  amount_cents: number;
  direction: ProjectCostItemDirection;
  evidence_level: ComplexCostEvidenceLevel;
  source: ProjectCostItemSource;
  source_payload: Record<string, unknown>;
  reason: string;
  status: ProjectCostItemStatus;
  created_by: string | null;
  created_at: string;
};

type ImportBatchRow = {
  id: string;
  organization_id: string;
  project_id: string;
  import_type: ProjectCostImportType;
  file_url: string | null;
  row_count: number;
  parsed_payload: Array<Record<string, unknown>>;
  status: ProjectCostImportStatus;
  created_by: string | null;
  created_at: string;
};

type QueryResult<T> = {
  data: T | null;
  error: Error | null;
};

export class SupabaseComplexCostRepository implements ComplexCostRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getProjectEntitlement(input: {
    organizationId: string;
    projectId: string;
  }): Promise<ProjectComplexCostEntitlementRecord | null> {
    const { data, error } = await this.client
      .from("project_complex_cost_rule_entitlements")
      .select("*")
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .maybeSingle<EntitlementRow>();

    if (error) {
      throw error;
    }
    return data ? mapEntitlementRow(data) : null;
  }

  async getNextRuleVersionNo(projectId: string): Promise<number> {
    const { data, error } = await this.client
      .from("project_cost_rule_versions")
      .select("version_no")
      .eq("project_id", projectId)
      .order("version_no", { ascending: false })
      .limit(1)
      .returns<Array<{ version_no: number }>>();

    if (error) {
      throw error;
    }
    return Number(data?.[0]?.version_no ?? 0) + 1;
  }

  async createRuleVersion(
    input: CreateRuleVersionRepoInput,
  ): Promise<ComplexCostRuleVersionRecord> {
    const { data, error } = await this.client
      .from("project_cost_rule_versions")
      .insert({
        organization_id: input.organizationId,
        project_id: input.projectId,
        version_no: input.versionNo,
        status: input.status,
        rule_payload: input.rulePayload,
        created_by: input.createdBy,
      })
      .select("*")
      .single<RuleVersionRow>();

    return mapRuleVersionRow(requireSingle({ data, error }));
  }

  async getRuleVersionById(
    versionId: string,
  ): Promise<ComplexCostRuleVersionRecord | null> {
    const { data, error } = await this.client
      .from("project_cost_rule_versions")
      .select("*")
      .eq("id", versionId)
      .maybeSingle<RuleVersionRow>();

    if (error) {
      throw error;
    }
    return data ? mapRuleVersionRow(data) : null;
  }

  async updateRuleVersion(
    versionId: string,
    patch: Partial<ComplexCostRuleVersionRecord>,
  ): Promise<ComplexCostRuleVersionRecord> {
    const { data, error } = await this.client
      .from("project_cost_rule_versions")
      .update(toRuleVersionPatch(patch))
      .eq("id", versionId)
      .select("*")
      .single<RuleVersionRow>();

    return mapRuleVersionRow(requireSingle({ data, error }));
  }

  async archiveActiveRuleVersions(input: {
    projectId: string;
    exceptVersionId: string;
  }): Promise<void> {
    const { error } = await this.client
      .from("project_cost_rule_versions")
      .update({ status: "archived" })
      .eq("project_id", input.projectId)
      .eq("status", "active")
      .neq("id", input.exceptVersionId);

    if (error) {
      throw error;
    }
  }

  async createProjectCostItem(
    input: CreateProjectCostItemRepoInput,
  ): Promise<ProjectCostItemRecord> {
    const { data, error } = await this.client
      .from("project_cost_items")
      .insert({
        organization_id: input.organizationId,
        project_id: input.projectId,
        streamer_id: input.streamerId,
        supplier_organization_id: input.supplierOrganizationId,
        live_report_id: input.liveReportId,
        settlement_batch_id: input.settlementBatchId,
        item_type: input.itemType,
        amount_cents: input.amountCents,
        direction: input.direction,
        evidence_level: input.evidenceLevel,
        source: input.source,
        source_payload: input.sourcePayload,
        reason: input.reason,
        status: input.status,
        created_by: input.createdBy,
      })
      .select("*")
      .single<CostItemRow>();

    return mapCostItemRow(requireSingle({ data, error }));
  }

  async listProjectCostItems(input: {
    organizationId: string;
    projectId: string;
    status?: ProjectCostItemStatus;
  }): Promise<ProjectCostItemRecord[]> {
    let query = this.client
      .from("project_cost_items")
      .select("*")
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .order("created_at", { ascending: false });

    if (input.status) {
      query = query.eq("status", input.status);
    }

    const { data, error } = await query.returns<CostItemRow[]>();
    if (error) {
      throw error;
    }
    return (data ?? []).map(mapCostItemRow);
  }

  async createImportBatch(
    input: CreateImportBatchRepoInput,
  ): Promise<ProjectCostImportBatchRecord> {
    const { data, error } = await this.client
      .from("project_cost_import_batches")
      .insert({
        organization_id: input.organizationId,
        project_id: input.projectId,
        import_type: input.importType,
        file_url: input.fileUrl,
        row_count: input.rowCount,
        parsed_payload: input.parsedPayload,
        status: input.status,
        created_by: input.createdBy,
      })
      .select("*")
      .single<ImportBatchRow>();

    return mapImportBatchRow(requireSingle({ data, error }));
  }

  async getImportBatchById(
    batchId: string,
  ): Promise<ProjectCostImportBatchRecord | null> {
    const { data, error } = await this.client
      .from("project_cost_import_batches")
      .select("*")
      .eq("id", batchId)
      .maybeSingle<ImportBatchRow>();

    if (error) {
      throw error;
    }
    return data ? mapImportBatchRow(data) : null;
  }

  async updateImportBatch(
    batchId: string,
    patch: Partial<ProjectCostImportBatchRecord>,
  ): Promise<ProjectCostImportBatchRecord> {
    const { data, error } = await this.client
      .from("project_cost_import_batches")
      .update(toImportBatchPatch(patch))
      .eq("id", batchId)
      .select("*")
      .single<ImportBatchRow>();

    return mapImportBatchRow(requireSingle({ data, error }));
  }

  async attachCostItemsToSettlementBatch(input: {
    organizationId: string;
    projectId: string;
    costItemIds: string[];
    settlementBatchId: string;
  }): Promise<ProjectCostItemRecord[]> {
    const { data, error } = await this.client
      .from("project_cost_items")
      .update({ settlement_batch_id: input.settlementBatchId })
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .eq("status", "confirmed")
      .in("id", input.costItemIds)
      .select("*")
      .returns<CostItemRow[]>();

    if (error) {
      throw error;
    }
    return (data ?? []).map(mapCostItemRow);
  }
}

export function mapEntitlementRow(
  row: EntitlementRow,
): ProjectComplexCostEntitlementRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    enabledSource: row.enabled_source,
    billingMode: row.billing_mode,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    monthlyPriceCents: Number(row.monthly_price_cents),
    createdBy: row.created_by,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export function mapRuleVersionRow(
  row: RuleVersionRow,
): ComplexCostRuleVersionRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    versionNo: Number(row.version_no),
    status: row.status,
    rulePayload: row.rule_payload ?? {},
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    effectiveFrom: row.effective_from,
    createdAt: row.created_at,
  };
}

export function mapCostItemRow(row: CostItemRow): ProjectCostItemRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    streamerId: row.streamer_id,
    supplierOrganizationId: row.supplier_organization_id,
    liveReportId: row.live_report_id,
    settlementBatchId: row.settlement_batch_id,
    itemType: row.item_type,
    amountCents: Number(row.amount_cents),
    direction: row.direction,
    evidenceLevel: row.evidence_level,
    source: row.source,
    sourcePayload: row.source_payload ?? {},
    reason: row.reason,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function mapImportBatchRow(
  row: ImportBatchRow,
): ProjectCostImportBatchRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    importType: row.import_type,
    fileUrl: row.file_url,
    rowCount: Number(row.row_count),
    parsedPayload: Array.isArray(row.parsed_payload) ? row.parsed_payload : [],
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function requireSingle<T>({ data, error }: QueryResult<T>): T {
  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Expected database row was not returned");
  }
  return data;
}

function toRuleVersionPatch(
  patch: Partial<ComplexCostRuleVersionRecord>,
): Record<string, unknown> {
  return removeUndefined({
    status: patch.status,
    rule_payload: patch.rulePayload,
    approved_by: patch.approvedBy,
    effective_from: patch.effectiveFrom,
  });
}

function toImportBatchPatch(
  patch: Partial<ProjectCostImportBatchRecord>,
): Record<string, unknown> {
  return removeUndefined({
    file_url: patch.fileUrl,
    row_count: patch.rowCount,
    parsed_payload: patch.parsedPayload,
    status: patch.status,
  });
}

function removeUndefined(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}
