import type {
  OpsSettlementBatchDetailItem,
  OpsSettlementBatchListItem,
  OpsSettlementPoolItem,
} from "./settlement-queries";

export type OpsReferenceBatch = {
  id: string;
  projectId: string;
  type: "vendor_receivable" | "streamer_payable";
  name: string;
  project: string;
  vendor: string;
  period: string;
  items: number;
  amount: number;
  status: string;
  updated: string;
  creator: string;
};

export type OpsReferenceBatchDetailItem = {
  streamer: string;
  id: string;
  rule: string;
  hours: number;
  qty: string;
  base: number;
  variable: number;
  adjust: number;
  total: number;
};

export type OpsReferenceSettlementPoolItem = {
  id: string;
  streamer: string;
  project: string;
  hours: number;
  evidence: string;
  rule: string;
  expected: number;
  approvedAt: string;
};

export function toOpsReferenceBatch(
  batch: OpsSettlementBatchListItem,
): OpsReferenceBatch {
  const isPayable = batch.batchType === "payable";

  return {
    id: batch.id,
    projectId: batch.projectId,
    type: isPayable ? "streamer_payable" : "vendor_receivable",
    name: `${batch.projectName} · ${isPayable ? "主播应付" : "厂家应收"}`,
    project: batch.projectName,
    vendor: isPayable ? "—" : batch.projectName,
    period: `${batch.periodStart} → ${batch.periodEnd}`,
    items: batch.itemCount,
    amount: batch.totalAmount,
    status: toReferenceStatus(batch.status),
    updated: formatShanghaiMinute(batch.updatedAt),
    creator: batch.createdBy ?? "system",
  };
}

export function toOpsReferenceBatchDetailItem(
  item: OpsSettlementBatchDetailItem,
): OpsReferenceBatchDetailItem {
  const isManual = item.itemType !== "live_report";
  return {
    streamer: item.streamerName,
    id: item.id,
    rule: isManual
      ? `${item.itemType.toUpperCase()} 人工承载`
      : "系统核验 CPT/底薪",
    hours: Math.round((item.settlementDuration / 60) * 10) / 10,
    qty: `${item.evidenceLevel ?? "unknown"} · ${item.timeSource}`,
    base: 0,
    variable: item.systemAmount + item.manualAmount,
    adjust: item.adjustmentAmount,
    total: item.totalAmount,
  };
}

export function toOpsReferenceSettlementPoolItem(
  item: OpsSettlementPoolItem,
): OpsReferenceSettlementPoolItem {
  return {
    id: item.id,
    streamer: item.streamerName,
    project: item.projectName,
    hours: Math.round(((item.settlementDuration ?? 0) / 60) * 10) / 10,
    evidence: `${item.evidenceLevel ?? "unknown"} · ${
      item.timeSource ?? "unknown"
    }`,
    rule: item.settlementMethod,
    expected: item.expectedAmount,
    approvedAt: formatShanghaiMinute(item.approvedAt),
  };
}

function toReferenceStatus(status: string): string {
  if (status === "pending") {
    return "pending_confirm";
  }

  return status;
}

function formatShanghaiMinute(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).formatToParts(date);

  const byType = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}`;
}
