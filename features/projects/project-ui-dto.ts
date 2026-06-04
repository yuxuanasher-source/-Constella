import type { ProjectListItem } from "./project-queries";

const statusLabels: Record<string, string> = {
  draft: "草稿",
  recruiting: "招募中",
  active: "进行中",
  scheduling: "排班中",
  live: "直播中",
  settling: "结算中",
  settlement: "结算中",
  paused: "已暂停",
  ended: "已结束",
  closed: "已结项",
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
  description: string;
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
};

export function toProjectCardDto(row: ProjectListItem): ProjectCardDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    agent: textOrFallback(row.agent_name, "—"),
    supplier: textOrFallback(row.supplier_name, "未填写"),
    vendor: textOrFallback(row.vendor_name, "未填写"),
    product: textOrFallback(row.product_name, row.name),
    status: uiStatusFromProjectStatus(row.status),
    statusLabel: statusLabels[row.status] ?? row.status,
    hourlyRateLabel: `${(row.default_hourly_rate / 100).toFixed(2)} 元/小时`,
    timingLabel: row.force_system_timing ? "系统计时" : "人工校验",
    publishedAtLabel: row.published_at
      ? row.published_at.slice(0, 10)
      : "未发布",
    pricing: settlementMethodLabel(row.default_settlement_method),
    description: row.description?.trim() || "",
    leadOps: "未分配",
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

export function toProjectCardDtos(rows: ProjectListItem[]) {
  return rows.map(toProjectCardDto);
}

function riskFromSensitivity(value: string): "low" | "medium" | "high" {
  if (value === "high") return "high";
  if (value === "sensitive" || value === "medium") return "medium";
  return "low";
}

function uiStatusFromProjectStatus(status: string) {
  if (status === "settlement") return "settling";
  if (status === "closed") return "ended";
  if (status === "scheduling" || status === "live") return "active";
  return status;
}
