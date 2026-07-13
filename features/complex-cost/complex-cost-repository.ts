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
  ExternalCostRuleExceptionPolicy,
  ExternalCostRuleExceptionRecord,
  ExternalCostRuleExceptionStatus,
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
  source_rule_version_id: string | null;
  source_import_batch_id: string | null;
  source_execution_key: string | null;
  source_input_hash: string | null;
  source_explanation: string | null;
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

type ExternalCostRuleExceptionRow = {
  id: string;
  organization_id: string;
  project_id: string;
  import_batch_id: string;
  import_row_index: number;
  rule_version_id: string | null;
  variable_name: string;
  policy: ExternalCostRuleExceptionPolicy;
  source_context_snapshot: Record<string, unknown>;
  status: ExternalCostRuleExceptionStatus;
  resolution_value: Record<string, unknown> | null;
  resolution_reason: string | null;
  created_by: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type ConfirmCostImportItemInput = {
  importRowIndex?: number;
  ruleVersionId?: string | null;
  streamerId?: string | null;
  supplierOrganizationId?: string | null;
  liveReportId?: string | null;
  itemType: ProjectCostItemType;
  amountCents: number;
  direction: ProjectCostItemDirection;
  evidenceLevel: ComplexCostEvidenceLevel;
  sourcePayload: Record<string, unknown>;
  sourceExecutionKey: string;
  sourceInputHash: string;
  sourceExplanation?: string | null;
  status: ProjectCostItemStatus;
};

export type ConfirmCostImportExceptionInput = {
  importRowIndex: number;
  ruleVersionId?: string | null;
  variableName: string;
  policy: ExternalCostRuleExceptionPolicy;
  sourceContextSnapshot: Record<string, unknown>;
};

export type ConfirmCostImportWithRuleItemsInput = {
  organizationId: string;
  projectId: string;
  importBatchId: string;
  idempotencyKey: string;
  inputHash: string;
  mode: "legacy" | "custom";
  reason: string;
  createdBy: string;
  legacyItems?: ConfirmCostImportItemInput[];
  customItems?: ConfirmCostImportItemInput[];
  exceptions?: ConfirmCostImportExceptionInput[];
};

export type ConfirmCostImportWithRuleItemsResult = {
  importBatch: ProjectCostImportBatchRecord;
  items: ProjectCostItemRecord[];
  exceptions: ExternalCostRuleExceptionRecord[];
  idempotencyStatus: "created" | "existing";
};

export type ResolveExternalCostRuleExceptionInput = {
  organizationId: string;
  exceptionId: string;
  resolutionValue: Record<string, unknown>;
  resolutionReason: string;
  resolvedBy: string;
};

export type ResolveExternalCostRuleExceptionResult = {
  exception: ExternalCostRuleExceptionRecord;
  items: ProjectCostItemRecord[];
  replayed: boolean;
};

type ProjectCostItemProvenanceInput = {
  sourceRuleVersionId?: string | null;
  sourceImportBatchId?: string | null;
  sourceExecutionKey?: string | null;
  sourceInputHash?: string | null;
  sourceExplanation?: string | null;
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
    const provenance = input as CreateProjectCostItemRepoInput &
      ProjectCostItemProvenanceInput;
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
        source_rule_version_id: provenance.sourceRuleVersionId,
        source_import_batch_id: provenance.sourceImportBatchId,
        source_execution_key: provenance.sourceExecutionKey,
        source_input_hash: provenance.sourceInputHash,
        source_explanation: provenance.sourceExplanation,
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

  async getProjectCostItemById(
    itemId: string,
  ): Promise<ProjectCostItemRecord | null> {
    const { data, error } = await this.client
      .from("project_cost_items")
      .select("*")
      .eq("id", itemId)
      .maybeSingle<CostItemRow>();

    if (error) {
      throw error;
    }
    return data ? mapCostItemRow(data) : null;
  }

  async updateProjectCostItem(
    itemId: string,
    patch: { status: ProjectCostItemStatus },
  ): Promise<ProjectCostItemRecord> {
    const { data, error } = await this.client
      .from("project_cost_items")
      .update({ status: patch.status })
      .eq("id", itemId)
      .select("*")
      .single<CostItemRow>();

    return mapCostItemRow(requireSingle({ data, error }));
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

  async confirmCostImportWithRuleItems(
    input: ConfirmCostImportWithRuleItemsInput,
  ): Promise<ConfirmCostImportWithRuleItemsResult> {
    const hasLegacyItems = (input.legacyItems?.length ?? 0) > 0;
    const hasCustomItems = (input.customItems?.length ?? 0) > 0;
    if (
      (input.mode === "legacy" && hasCustomItems) ||
      (input.mode === "custom" && hasLegacyItems)
    ) {
      throw new Error(
        "Confirm cost import accepts either legacy or custom mode, not both",
      );
    }

    const { data, error } = await this.client.rpc(
      "confirm_cost_import_with_rule_items",
      {
        p_organization_id: input.organizationId,
        p_project_id: input.projectId,
        p_import_batch_id: input.importBatchId,
        p_idempotency_key: input.idempotencyKey,
        p_input_hash: input.inputHash,
        p_mode: input.mode,
        p_reason: input.reason,
        p_created_by: input.createdBy,
        p_legacy_items: input.legacyItems
          ? input.legacyItems.map(toRpcCostItem)
          : null,
        p_custom_items: input.customItems
          ? input.customItems.map(toRpcCostItem)
          : null,
        p_exceptions: input.exceptions
          ? input.exceptions.map(toRpcException)
          : null,
      },
    );

    const payload = requireSingle({
      data: data as ConfirmCostImportRpcResult | null,
      error,
    });

    return {
      importBatch: mapImportBatchRow(payload.import_batch),
      items: (payload.items ?? []).map(mapCostItemRow),
      exceptions: (payload.exceptions ?? []).map(mapExternalCostRuleExceptionRow),
      idempotencyStatus: payload.idempotency_status,
    };
  }

  async resolveExternalCostRuleException(
    input: ResolveExternalCostRuleExceptionInput,
  ): Promise<ResolveExternalCostRuleExceptionResult> {
    const { data, error } = await this.client.rpc(
      "resolve_external_cost_rule_exception",
      {
        p_organization_id: input.organizationId,
        p_exception_id: input.exceptionId,
        p_resolution_value: input.resolutionValue,
        p_resolution_reason: input.resolutionReason,
        p_resolved_by: input.resolvedBy,
      },
    );

    const payload = requireSingle({
      data: data as ResolveExternalCostRuleExceptionRpcResult | null,
      error,
    });

    return {
      exception: mapExternalCostRuleExceptionRow(payload.exception),
      items: (payload.items ?? []).map(mapCostItemRow),
      replayed: Boolean(payload.replayed),
    };
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
    sourceRuleVersionId: row.source_rule_version_id,
    sourceImportBatchId: row.source_import_batch_id,
    sourceExecutionKey: row.source_execution_key,
    sourceInputHash: row.source_input_hash,
    sourceExplanation: row.source_explanation,
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

type ConfirmCostImportRpcResult = {
  import_batch: ImportBatchRow;
  items: CostItemRow[];
  exceptions: ExternalCostRuleExceptionRow[];
  idempotency_status: "created" | "existing";
};

type ResolveExternalCostRuleExceptionRpcResult = {
  exception: ExternalCostRuleExceptionRow;
  items: CostItemRow[];
  replayed: boolean;
};

export function mapExternalCostRuleExceptionRow(
  row: ExternalCostRuleExceptionRow,
): ExternalCostRuleExceptionRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    importBatchId: row.import_batch_id,
    importRowIndex: Number(row.import_row_index),
    ruleVersionId: row.rule_version_id,
    variableName: row.variable_name,
    policy: row.policy,
    sourceContextSnapshot: row.source_context_snapshot ?? {},
    status: row.status,
    resolutionValue: row.resolution_value,
    resolutionReason: row.resolution_reason,
    createdBy: row.created_by,
    resolvedBy: row.resolved_by,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function toRpcCostItem(
  input: ConfirmCostImportItemInput,
): Record<string, unknown> {
  return removeUndefined({
    import_row_index: input.importRowIndex,
    rule_version_id: input.ruleVersionId,
    streamer_id: input.streamerId,
    supplier_organization_id: input.supplierOrganizationId,
    live_report_id: input.liveReportId,
    item_type: input.itemType,
    amount_cents: input.amountCents,
    direction: input.direction,
    evidence_level: input.evidenceLevel,
    source_payload: input.sourcePayload,
    source_execution_key: input.sourceExecutionKey,
    source_input_hash: input.sourceInputHash,
    source_explanation: input.sourceExplanation,
    status: input.status,
  });
}

function toRpcException(
  input: ConfirmCostImportExceptionInput,
): Record<string, unknown> {
  return removeUndefined({
    import_row_index: input.importRowIndex,
    rule_version_id: input.ruleVersionId,
    variable_name: input.variableName,
    policy: input.policy,
    source_context_snapshot: input.sourceContextSnapshot,
  });
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
