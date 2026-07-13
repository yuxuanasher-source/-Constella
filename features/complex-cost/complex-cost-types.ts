import type { AppRole } from "@/lib/rbac/roles";

export type ComplexCostRuleScenario =
  | "cpt"
  | "base_salary_cpt"
  | "cpa"
  | "cps"
  | "gift"
  | "supplier"
  | "traffic"
  | "replay_penalty";

export type ComplexCostRuleStatus = "draft" | "active" | "archived";

export type ProjectCostItemType =
  | "cpa"
  | "cps"
  | "gift"
  | "bonus"
  | "penalty"
  | "supplier_fee"
  | "traffic"
  | "platform_fee"
  | "sample"
  | "replay"
  | "tax"
  | "manual";

export type ProjectCostItemDirection = "cost" | "revenue_offset" | "adjustment";

export type ComplexCostEvidenceLevel = "green" | "yellow" | "red";
export type ProjectCostItemSource = "system" | "import" | "manual";
export type ProjectCostItemStatus =
  | "draft"
  | "pending_review"
  | "confirmed"
  | "voided";

export type ProjectCostImportType =
  | "cpa"
  | "cps"
  | "gift"
  | "traffic"
  | "supplier_bill";

export type ProjectCostImportStatus =
  | "uploaded"
  | "parsed"
  | "confirmed"
  | "failed";

export type ComplexCostActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
};

export type ProjectComplexCostEntitlementRecord = {
  id?: string;
  organizationId: string;
  projectId: string;
  enabledSource: "plan" | "addon" | "override";
  billingMode: "included" | "per_project_monthly" | "enterprise";
  validFrom?: string;
  validTo?: string | null;
  monthlyPriceCents?: number;
  createdBy?: string | null;
  reason?: string;
  createdAt?: string;
};

export type ComplexCostRuleVersionRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  versionNo: number;
  status: ComplexCostRuleStatus;
  rulePayload: Record<string, unknown>;
  createdBy?: string | null;
  approvedBy?: string | null;
  effectiveFrom?: string | null;
  createdAt?: string;
};

export type ProjectCostItemRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  streamerId?: string | null;
  supplierOrganizationId?: string | null;
  liveReportId?: string | null;
  settlementBatchId?: string | null;
  itemType: ProjectCostItemType;
  amountCents: number;
  direction: ProjectCostItemDirection;
  evidenceLevel: ComplexCostEvidenceLevel;
  source: ProjectCostItemSource;
  sourcePayload: Record<string, unknown>;
  sourceRuleVersionId?: string | null;
  sourceImportBatchId?: string | null;
  sourceExecutionKey?: string | null;
  sourceInputHash?: string | null;
  sourceExplanation?: string | null;
  reason: string;
  status: ProjectCostItemStatus;
  createdBy?: string | null;
  createdAt?: string;
};

export type ProjectCostImportBatchRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  importType: ProjectCostImportType;
  fileUrl?: string | null;
  rowCount: number;
  parsedPayload: Array<Record<string, unknown>>;
  status: ProjectCostImportStatus;
  createdBy?: string | null;
  createdAt?: string;
};

export type CreateProjectCostItemInput = {
  projectId: string;
  streamerId?: string | null;
  supplierOrganizationId?: string | null;
  liveReportId?: string | null;
  settlementBatchId?: string | null;
  itemType: ProjectCostItemType;
  amountCents: number;
  direction: ProjectCostItemDirection;
  evidenceLevel: ComplexCostEvidenceLevel;
  source?: ProjectCostItemSource;
  sourcePayload?: Record<string, unknown>;
  sourceRuleVersionId?: string | null;
  sourceImportBatchId?: string | null;
  sourceExecutionKey?: string | null;
  sourceInputHash?: string | null;
  sourceExplanation?: string | null;
  reason: string;
  status?: ProjectCostItemStatus;
};

export type ExternalCostRuleExceptionStatus =
  | "review_required"
  | "resolved"
  | "voided";

export type ExternalCostRuleExceptionPolicy =
  | "route_item_to_review"
  | "block_batch"
  | "use_explicit_default";

export type ExternalCostRuleExceptionRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  importBatchId: string;
  importRowIndex: number;
  ruleVersionId?: string | null;
  variableName: string;
  policy: ExternalCostRuleExceptionPolicy;
  sourceContextSnapshot: Record<string, unknown>;
  status: ExternalCostRuleExceptionStatus;
  resolutionValue?: Record<string, unknown> | null;
  resolutionReason?: string | null;
  createdBy?: string | null;
  resolvedBy?: string | null;
  createdAt?: string;
  resolvedAt?: string | null;
};

export type SettlementReconciliationRunTriggerType =
  | "manual"
  | "import_batch"
  | "settlement_batch"
  | "scheduled";

export type SettlementReconciliationRunRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  periodStart: string;
  periodEnd: string;
  triggerType: SettlementReconciliationRunTriggerType;
  triggerBatchId?: string | null;
  coreInputHash: string;
  coreResult: Record<string, unknown>;
  ruleVersionId?: string | null;
  formulaHash?: string | null;
  customChecks: Record<string, unknown>;
  finalChecks: Record<string, unknown>;
  blocked: boolean;
  warnings: unknown[];
  createdBy?: string | null;
  createdAt?: string;
};

export type ComplexCostDashboardRecord = {
  expectedReceivableCents?: number;
  streamerPayableCents?: number;
  supplierCostCents?: number;
  trafficCostCents?: number;
  platformFeeCents?: number;
  manualAdjustmentCents?: number;
  // Project financial settings layer (Phase 2): tax + procurement.
  isInvoiced?: boolean;
  outputVatRateBps?: number;
  surtaxRateBps?: number;
  outputVatCents?: number;
  surtaxCents?: number;
  procurementCostCents?: number;
  taxTotalCents?: number;
  grossMarginCents?: number;
  marginRateBps?: number;
  items: ProjectCostItemRecord[];
};
