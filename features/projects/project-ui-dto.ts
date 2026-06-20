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
  leadOps: string;
  bizOwner: string;
  start: string;
  end: string;
  startsAt: string | null;
  endsAt: string | null;
  openSignup: boolean;
  allowDirectInvite: boolean;
  isPublicToStreamers: boolean;
  publicSummary: string;
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
    agent: "—",
    supplier: "未填写",
    vendor: "未填写",
    product: row.name,
    status: uiStatusFromProjectStatus(row.status),
    statusLabel: statusLabels[row.status] ?? row.status,
    hourlyRateLabel: `${(row.default_hourly_rate / 100).toFixed(2)} 元/小时`,
    timingLabel: row.force_system_timing ? "系统计时" : "人工校验",
    publishedAtLabel: row.published_at ? row.published_at.slice(0, 10) : "未发布",
    pricing: "CPT",
    leadOps: "未分配",
    bizOwner: "未分配",
    start: (row.starts_at ?? row.created_at).slice(0, 10),
    end:
      row.ends_at?.slice(0, 10) ??
      row.published_at?.slice(0, 10) ??
      row.created_at.slice(0, 10),
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
    openSignup: row.open_signup ?? true,
    allowDirectInvite: row.allow_direct_invite ?? true,
    isPublicToStreamers: row.is_public_to_streamers ?? false,
    publicSummary: row.public_summary ?? "",
    needScreening: row.force_recording ?? true,
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
