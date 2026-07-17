import type { AppRole as UserRole } from "@/lib/rbac/roles";

export type FinanceBatchType =
  | "receivable"
  | "streamer_payable"
  | "project_cost"
  | "collaboration_share";

export type FinanceBatchStatus =
  | "draft"
  | "pending_review"
  | "confirmed"
  | "locked"
  | "exported"
  | "completed"
  | "rejected"
  | "reopened"
  | "voided";

export type FinanceBatchAction =
  | "submit"
  | "confirm"
  | "lock"
  | "export"
  | "complete"
  | "reject"
  | "reopen"
  | "void";

export type FinanceAdjustmentDirection = "increase" | "decrease";

export type FinanceCounterpartyType =
  | "customer"
  | "streamer"
  | "project"
  | "collaboration_partner";

export type FinanceSourceType =
  | "live_report"
  | "settlement_rule_result"
  | "receivable_rule_result"
  | "project_cost_item"
  | "cost_import_item"
  | "collaboration_settlement_item"
  | "project_collaboration_share";

export type FinanceActor = {
  userId: string;
  name?: string | null;
  role: UserRole;
  organizationId: string;
};

export type FinanceBatchRecord = {
  id: string;
  organizationId: string;
  batchType: FinanceBatchType;
  title: string | null;
  periodStart: string;
  periodEnd: string;
  status: FinanceBatchStatus;
  hasExceptions: boolean;
  systemAmount: number;
  adjustmentAmount: number;
  finalAmount: number;
  itemCount: number;
  exceptionCount: number;
  createdBy: string | null;
  statusReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type FinanceBatchItemRecord = {
  id: string;
  organizationId: string;
  financeBatchId: string;
  batchType: FinanceBatchType;
  projectId: string;
  counterpartyType: FinanceCounterpartyType;
  counterpartyId: string | null;
  counterpartyNameSnapshot: string | null;
  sourceType: FinanceSourceType;
  sourceId: string;
  sourceSnapshot: Record<string, unknown>;
  systemAmount: number;
  adjustmentAmount: number;
  finalAmount: number;
  evidenceLevel: string | null;
  evidenceSnapshot: Record<string, unknown>;
  status: "active" | "voided";
  exceptionFlags: string[];
  createdAt: string;
  updatedAt: string;
};

export type FinanceBatchAdjustmentRecord = {
  id: string;
  organizationId: string;
  financeBatchId: string;
  financeBatchItemId: string | null;
  direction: FinanceAdjustmentDirection;
  amount: number;
  reason: string;
  evidenceSnapshot: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  voidedAt: string | null;
};

export type CreateFinanceBatchInput = {
  batchType: FinanceBatchType;
  title?: string;
  periodStart: string;
  periodEnd: string;
  selection: {
    projectIds?: string[];
    streamerIds?: string[];
    sourceIds?: string[];
  };
};
