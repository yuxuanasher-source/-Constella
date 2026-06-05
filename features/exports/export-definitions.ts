import type { AppRole } from "@/lib/rbac/roles";

export type ExportKind =
  | "project_execution"
  | "report_details"
  | "settlement_batch"
  | "audit_logs"
  | "vendor_delivery";

export type ExportField = {
  key: string;
  label: string;
  sensitivity: "public" | "internal" | "finance_sensitive";
};

export const exportDefinitions: Record<ExportKind, ExportField[]> = {
  vendor_delivery: [
    { key: "projectName", label: "项目名称", sensitivity: "public" },
    { key: "streamerName", label: "主播", sensitivity: "public" },
    { key: "settlementDuration", label: "结算时长", sensitivity: "public" },
    { key: "evidenceLevel", label: "证据等级", sensitivity: "public" },
  ],
  project_execution: [
    { key: "projectName", label: "项目名称", sensitivity: "public" },
    { key: "status", label: "状态", sensitivity: "internal" },
    { key: "operatorName", label: "负责人", sensitivity: "internal" },
  ],
  report_details: [
    { key: "streamerName", label: "主播", sensitivity: "public" },
    { key: "settlementDuration", label: "结算时长", sensitivity: "public" },
    { key: "evidenceLevel", label: "证据等级", sensitivity: "public" },
  ],
  settlement_batch: [
    { key: "batchName", label: "批次", sensitivity: "internal" },
    {
      key: "payableAmountCents",
      label: "应付金额",
      sensitivity: "finance_sensitive",
    },
    {
      key: "vendorReceivableCents",
      label: "厂家应收",
      sensitivity: "finance_sensitive",
    },
  ],
  audit_logs: [
    { key: "module", label: "模块", sensitivity: "internal" },
    { key: "action", label: "动作", sensitivity: "internal" },
    { key: "actorName", label: "操作人", sensitivity: "internal" },
  ],
};

export function getAllowedExportFields(
  kind: ExportKind,
  role: AppRole,
): ExportField[] {
  const fields = exportDefinitions[kind];
  if (kind === "vendor_delivery") {
    return fields.filter((field) => field.sensitivity === "public");
  }

  if (role === "streamer" || role === "operator_business") {
    return fields.filter((field) => field.sensitivity !== "finance_sensitive");
  }

  return fields;
}

export function isExportKind(value: unknown): value is ExportKind {
  return (
    value === "project_execution" ||
    value === "report_details" ||
    value === "settlement_batch" ||
    value === "audit_logs" ||
    value === "vendor_delivery"
  );
}
