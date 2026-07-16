import type { FinanceBatchRecord, FinanceBatchType } from "./finance-batch-types";

export type OpsReferenceFinanceBatch = {
  id: string;
  type: FinanceBatchType;
  typeLabel: string;
  status: string;
  statusLabel: string;
  statusTone:
    | "neutral"
    | "blue"
    | "green"
    | "amber"
    | "red"
    | "violet"
    | "teal";
  title: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  finalAmountCents: number;
  itemCount: number;
};

export const FINANCE_BATCH_TYPE_LABELS: Record<FinanceBatchType, string> = {
  receivable: "客户应收",
  streamer_payable: "主播应付",
  project_cost: "项目成本",
  collaboration_share: "协作分账",
};

export const FINANCE_BATCH_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  pending_review: "待审核",
  confirmed: "已确认",
  locked: "已锁定",
  exported: "已导出",
  completed: "已完成",
  rejected: "已驳回",
  reopened: "已重开",
  voided: "已作废",
};

const FINANCE_BATCH_STATUS_TONES: Record<
  string,
  OpsReferenceFinanceBatch["statusTone"]
> = {
  draft: "neutral",
  pending_review: "amber",
  confirmed: "blue",
  locked: "violet",
  exported: "teal",
  completed: "green",
  rejected: "red",
  reopened: "amber",
  voided: "neutral",
};

export function toOpsReferenceFinanceBatch(
  batch: FinanceBatchRecord,
): OpsReferenceFinanceBatch {
  const typeLabel = FINANCE_BATCH_TYPE_LABELS[batch.batchType];
  return {
    id: batch.id,
    type: batch.batchType,
    typeLabel,
    status: batch.status,
    statusLabel: FINANCE_BATCH_STATUS_LABELS[batch.status] ?? batch.status,
    statusTone: FINANCE_BATCH_STATUS_TONES[batch.status] ?? "neutral",
    title: batch.title?.trim() || `${typeLabel}批次`,
    period: `${batch.periodStart} → ${batch.periodEnd}`,
    periodStart: batch.periodStart,
    periodEnd: batch.periodEnd,
    finalAmountCents: batch.finalAmount,
    itemCount: batch.itemCount,
  };
}
