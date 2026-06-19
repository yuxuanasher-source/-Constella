import type { ProjectListItem } from "./project-queries";

const statusLabels: Record<string, string> = {
  draft: "草稿",
  recruiting: "招募中",
  pending_start: "待开始",
  active: "进行中",
  settling: "结算中",
  paused: "已暂停",
  ended: "已结束",
  archived: "已归档",
};

export type ProjectCardDto = {
  id: string;
  code: string;
  name: string;
  agent: string;
  supplier: string;
  vendor: string;
  product: string;
  status: string;
  statusLabel: string;
  hourlyRateLabel: string;
  timingLabel: string;
  publishedAtLabel: string;
  pricing: string;
  defaultSettlementMethod: string;
  defaultHourlyRate: number;
  defaultBaseSalary: number;
  defaultSettlementRule: Record<string, unknown>;
  isInvoiced: boolean;
  outputVatRateBps: number;
  surtaxRateBps: number;
  procurementCostCents: number;
  description: string;
  isPublicToStreamers: boolean;
  publicSummary: string;
  gameDownloadUrl: string | null;
  isOpenToMcnCollaboration: boolean;
  mcnCollaborationSummary: string;
  mcnCollaborationTerms: Record<string, unknown>;
  ownerId: string | null;
  leadOps: string;
  bizOwner: string;
  start: string;
  end: string;
  openSignup: boolean;
  allowDirectInvite: boolean;
  needScreening: boolean;
  needStartStop: boolean;
  streamers: {
    active: number;
    candidate: number;
    pendingReview: number;
  };
  metrics: {
    plannedHours: number;
    doneHours: number;
    audience: number;
    reportedPending: number;
    anomalies: number;
    receivable: number;
    payable: number;
    gross: number;
    margin: number;
  };
  risk: "low" | "medium" | "high";
  collaborationRole?: "owner" | "partner";
  collaborationId?: string;
  collaborationAgreementId?: string;
  collaborationApplicationId?: string;
  collaborationApplicationStatus?: string;
  requestedRevenueShareBps?: number;
  ownerCounterRevenueShareBps?: number | null;
  ownerOrganizationName?: string;
  collaborationSummary?: string;
};

export type PartnerCollaborationProjectListItem = {
  agreement: {
    id: string;
    status: string;
    revenueShareBps: number;
    settlementBasis: string;
  };
  project: {
    id: string;
    name: string;
    code: string;
    ownerOrganizationName: string;
    collaborationSummary: string;
  };
};

export type PartnerCollaborationApplicationProjectListItem = {
  application: {
    id: string;
    status: string;
    requestedRevenueShareBps: number;
    ownerCounterRevenueShareBps: number | null;
  };
  project: {
    id: string;
    name: string;
    code: string;
    ownerOrganizationName: string;
    collaborationSummary: string;
  };
};

export function toProjectCardDto(row: ProjectListItem): ProjectCardDto {
  const uiStatus = uiStatusFromProject(row);

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    agent: textOrFallback(row.agent_name, "—"),
    supplier: textOrFallback(row.supplier_name, "未填写"),
    vendor: textOrFallback(row.vendor_name, "未填写"),
    product: textOrFallback(row.product_name, row.name),
    status: uiStatus,
    statusLabel: statusLabels[uiStatus] ?? uiStatus,
    hourlyRateLabel: `${(row.default_hourly_rate / 100).toFixed(2)} 元/小时`,
    timingLabel: row.force_system_timing ? "系统计时" : "人工校验",
    publishedAtLabel: row.published_at
      ? row.published_at.slice(0, 10)
      : "未发布",
    pricing: settlementMethodLabel(row.default_settlement_method),
    defaultSettlementMethod: row.default_settlement_method || "cpt",
    defaultHourlyRate: row.default_hourly_rate ?? 0,
    defaultBaseSalary: row.default_base_salary ?? 0,
    defaultSettlementRule: recordOrEmpty(row.default_settlement_rule),
    isInvoiced: row.is_invoiced ?? false,
    outputVatRateBps: row.output_vat_rate_bps ?? 0,
    surtaxRateBps: row.surtax_rate_bps ?? 0,
    procurementCostCents: row.procurement_cost_cents ?? 0,
    description: row.description?.trim() || "",
    isPublicToStreamers: row.is_public_to_streamers,
    publicSummary: row.public_summary?.trim() || "",
    gameDownloadUrl: row.game_download_url?.trim() || null,
    isOpenToMcnCollaboration: row.is_open_to_mcn_collaboration ?? false,
    mcnCollaborationSummary: row.mcn_collaboration_summary?.trim() || "",
    mcnCollaborationTerms: row.mcn_collaboration_terms ?? {},
    ownerId: row.owner_id ?? row.created_by ?? null,
    leadOps: projectOwnerName(row),
    bizOwner: "未分配",
    start: row.starts_at?.slice(0, 10) ?? row.created_at.slice(0, 10),
    end:
      row.ends_at?.slice(0, 10) ??
      row.published_at?.slice(0, 10) ??
      row.created_at.slice(0, 10),
    openSignup: row.open_signup,
    allowDirectInvite: row.allow_direct_invite,
    needScreening: row.force_recording,
    needStartStop: row.force_system_timing,
    streamers: { active: 0, candidate: 0, pendingReview: 0 },
    metrics: {
      plannedHours: 0,
      doneHours: 0,
      audience: 0,
      reportedPending: 0,
      anomalies: 0,
      receivable: 0,
      payable: 0,
      gross: 0,
      margin: 0,
    },
    risk: riskFromSensitivity(row.sensitivity),
  };
}

function textOrFallback(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized || fallback;
}

function projectOwnerName(row: ProjectListItem) {
  return (
    relationName(row.owner) ||
    relationName(row.creator) ||
    textOrFallback(undefined, "未分配")
  );
}

function relationName(
  relation:
    | { full_name: string | null }
    | { full_name: string | null }[]
    | null
    | undefined,
) {
  const profile = Array.isArray(relation) ? relation[0] : relation;
  return profile?.full_name?.trim() || "";
}

function settlementMethodLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    cpt: "CPT",
    cpa: "CPA",
    cps: "CPS",
    gift: "礼物流水",
    base_salary: "保底",
    base_salary_cpt: "保底 + CPT",
    manual: "手动结算",
  };
  return labels[value || ""] || "CPT";
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function toProjectCardDtos(rows: ProjectListItem[]) {
  return rows.map(toProjectCardDto);
}

export function toCollaborationProjectCardDto(
  row: PartnerCollaborationProjectListItem,
): ProjectCardDto {
  return {
    id: row.project.id,
    code: row.project.code,
    name: row.project.name,
    agent: "外部合作",
    supplier: row.project.ownerOrganizationName,
    vendor: row.project.ownerOrganizationName,
    product: row.project.name,
    status: row.agreement.status === "active" ? "active" : "recruiting",
    statusLabel: row.agreement.status === "active" ? "进行中" : "招募中",
    hourlyRateLabel: "按协作协议",
    timingLabel: "本组织执行",
    publishedAtLabel: "协作项目",
    pricing: `分成 ${(row.agreement.revenueShareBps / 100).toFixed(2)}%`,
    defaultSettlementMethod: "manual",
    defaultHourlyRate: 0,
    defaultBaseSalary: 0,
    defaultSettlementRule: {},
    isInvoiced: false,
    outputVatRateBps: 0,
    surtaxRateBps: 0,
    procurementCostCents: 0,
    description: row.project.collaborationSummary || "",
    isPublicToStreamers: false,
    publicSummary: "",
    gameDownloadUrl: null,
    isOpenToMcnCollaboration: true,
    mcnCollaborationSummary: row.project.collaborationSummary || "",
    mcnCollaborationTerms: {},
    ownerId: null,
    leadOps: row.project.ownerOrganizationName,
    bizOwner: "外部合作",
    start: "",
    end: "",
    openSignup: false,
    allowDirectInvite: false,
    needScreening: true,
    needStartStop: true,
    streamers: { active: 0, candidate: 0, pendingReview: 0 },
    metrics: {
      plannedHours: 0,
      doneHours: 0,
      audience: 0,
      reportedPending: 0,
      anomalies: 0,
      receivable: 0,
      payable: 0,
      gross: 0,
      margin: 0,
    },
    risk: "low",
    collaborationRole: "partner",
    collaborationId: row.agreement.id,
    collaborationAgreementId: row.agreement.id,
    ownerOrganizationName: row.project.ownerOrganizationName,
    collaborationSummary: row.project.collaborationSummary,
  };
}

export function toCollaborationProjectCardDtos(
  rows: PartnerCollaborationProjectListItem[],
) {
  return rows.map(toCollaborationProjectCardDto);
}

export function toCollaborationApplicationProjectCardDto(
  row: PartnerCollaborationApplicationProjectListItem,
): ProjectCardDto {
  const ownerCounter = row.application.ownerCounterRevenueShareBps;
  const statusLabel =
    row.application.status === "owner_countered"
      ? "\u5f85\u786e\u8ba4\u53cd\u62a5\u4ef7"
      : "\u5f85\u9879\u76ee\u65b9\u5ba1\u6838";
  const pricing = ownerCounter
    ? `\u7533\u8bf7\u5206\u6210 ${(row.application.requestedRevenueShareBps / 100).toFixed(2)}% \u00b7 \u53cd\u62a5\u4ef7 ${(ownerCounter / 100).toFixed(2)}%`
    : `\u7533\u8bf7\u5206\u6210 ${(row.application.requestedRevenueShareBps / 100).toFixed(2)}%`;

  return {
    id: row.project.id,
    code: row.project.code,
    name: row.project.name,
    agent: "\u5916\u90e8\u5408\u4f5c",
    supplier: row.project.ownerOrganizationName,
    vendor: row.project.ownerOrganizationName,
    product: row.project.name,
    status: "recruiting",
    statusLabel,
    hourlyRateLabel: "\u5f85\u534f\u4f5c\u786e\u8ba4",
    timingLabel: "\u672c\u7ec4\u7ec7\u6267\u884c",
    publishedAtLabel: "\u534f\u4f5c\u7533\u8bf7",
    pricing,
    defaultSettlementMethod: "manual",
    defaultHourlyRate: 0,
    defaultBaseSalary: 0,
    defaultSettlementRule: {},
    isInvoiced: false,
    outputVatRateBps: 0,
    surtaxRateBps: 0,
    procurementCostCents: 0,
    description: row.project.collaborationSummary || "",
    isPublicToStreamers: false,
    publicSummary: "",
    gameDownloadUrl: null,
    isOpenToMcnCollaboration: true,
    mcnCollaborationSummary: row.project.collaborationSummary || "",
    mcnCollaborationTerms: {},
    ownerId: null,
    leadOps: row.project.ownerOrganizationName,
    bizOwner: "\u5916\u90e8\u5408\u4f5c",
    start: "",
    end: "",
    openSignup: false,
    allowDirectInvite: false,
    needScreening: true,
    needStartStop: true,
    streamers: { active: 0, candidate: 0, pendingReview: 0 },
    metrics: {
      plannedHours: 0,
      doneHours: 0,
      audience: 0,
      reportedPending: 0,
      anomalies: 0,
      receivable: 0,
      payable: 0,
      gross: 0,
      margin: 0,
    },
    risk: "low",
    collaborationRole: "partner",
    collaborationApplicationId: row.application.id,
    collaborationApplicationStatus: row.application.status,
    requestedRevenueShareBps: row.application.requestedRevenueShareBps,
    ownerCounterRevenueShareBps: ownerCounter,
    ownerOrganizationName: row.project.ownerOrganizationName,
    collaborationSummary: row.project.collaborationSummary,
  };
}

export function toCollaborationApplicationProjectCardDtos(
  rows: PartnerCollaborationApplicationProjectListItem[],
) {
  return rows.map(toCollaborationApplicationProjectCardDto);
}

function riskFromSensitivity(value: string): "low" | "medium" | "high" {
  if (value === "high") return "high";
  if (value === "sensitive" || value === "medium") return "medium";
  return "low";
}

function uiStatusFromProjectStatus(status: string) {
  return status;
}

function uiStatusFromProject(row: ProjectListItem) {
  const status = uiStatusFromProjectStatus(row.status);
  if (status === "settling" || status === "ended" || status === "paused") {
    return status;
  }
  if (hasSettlementWorkflow(row)) {
    return "settling";
  }
  return status;
}

function hasSettlementWorkflow(row: ProjectListItem) {
  return hasSettlementBatch(row) || hasApprovedPoolReport(row);
}

function hasSettlementBatch(row: ProjectListItem) {
  return (row.settlement_batches ?? []).some((batch) => Boolean(batch.id));
}

function hasApprovedPoolReport(row: ProjectListItem) {
  return (row.live_reports ?? []).some(
    (report) =>
      report.status === "approved" &&
      report.enter_settlement_pool !== false &&
      !report.settled_batch_item_id,
  );
}
