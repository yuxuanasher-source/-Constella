import type { OpsSettlementBatchListItem } from "./settlement-queries";

export type OpsReferenceBatch = {
  id: string;
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

export function toOpsReferenceBatch(
  batch: OpsSettlementBatchListItem,
): OpsReferenceBatch {
  const isPayable = batch.batchType === "payable";

  return {
    id: batch.id,
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
