// L1 感知（方案第 3.2 / 6.2 节）：黑名单比对 + 主播画像（脱敏）。
// 架构约束：工具是确定性变换器，本身不碰库。读取走 RLS 在路由层完成，把记录作为
// input 传入；工具只做确定性判定 / 角色脱敏 —— 工具永不成为绕过 RLS / 脱敏的点。

import type { AppRole } from "@/lib/rbac/roles";

const toArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item)) : [];
const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

// ===== 黑名单 / 高风险比对（准入拦截）=====
export type BlacklistMatchInput = {
  riskLevel?: unknown;
  riskTags?: unknown;
  blacklistReason?: unknown;
  displayName?: unknown;
};

export type BlacklistSeverity = "block" | "review" | "clear";
export type BlacklistMatch = {
  hit: boolean;
  severity: BlacklistSeverity;
  matchedOn: string[];
  reason: string;
  recommendation: string;
};

// 高风险标签（命中即转人工复核）。文本标签做关键字兜底。
const HIGH_RISK_TAG_KEYWORDS = ["黑", "封", "诈", "骗", "刷", "违规", "造假", "盗"];
const HIGH_RISK_TAGS = new Set([
  "fraud",
  "duration_fraud",
  "data_falsification",
  "chargeback",
  "banned",
  "high_risk",
]);

function isHighRiskTag(tag: string): boolean {
  if (HIGH_RISK_TAGS.has(tag)) return true;
  return HIGH_RISK_TAG_KEYWORDS.some((kw) => tag.includes(kw));
}

export function matchBlacklist(input: BlacklistMatchInput): BlacklistMatch {
  const level = String(input.riskLevel ?? "").toLowerCase();
  const tags = toArray(input.riskTags);
  const matchedOn: string[] = [];

  if (level === "blacklisted") matchedOn.push("risk_level:blacklisted");
  const riskyTags = tags.filter(isHighRiskTag);
  for (const tag of riskyTags) matchedOn.push(`risk_tag:${tag}`);

  const reason =
    (typeof input.blacklistReason === "string" && input.blacklistReason.trim()) ||
    (matchedOn.length ? matchedOn.join("、") : "无");

  if (level === "blacklisted") {
    return {
      hit: true,
      severity: "block",
      matchedOn,
      reason,
      recommendation: "命中黑名单：拦截准入。如需放行须人工复核并在审计中记录原因。",
    };
  }
  if (level === "high" || riskyTags.length > 0) {
    if (level === "high") matchedOn.push("risk_level:high");
    return {
      hit: true,
      severity: "review",
      matchedOn,
      reason,
      recommendation: "高风险信号：转人工复核后再决定是否准入。",
    };
  }
  return {
    hit: false,
    severity: "clear",
    matchedOn,
    reason: "未命中黑名单 / 高风险信号",
    recommendation: "未命中黑名单，可继续准入流程。",
  };
}

export function blacklistSummary(match: BlacklistMatch): string {
  if (match.severity === "block") return `命中黑名单（${match.reason}）。${match.recommendation}`;
  if (match.severity === "review") return `高风险待复核（${match.reason}）。${match.recommendation}`;
  return `未命中黑名单。${match.recommendation}`;
}

// ===== 主播画像（脱敏摘要）=====
// 主播端只看自身画像基础信息，隐藏内部风控/运营备注与价格；MCN 员工看完整。
export type StreamerProfileSummary = {
  displayName: string;
  categories: string[];
  platforms: string[];
  styles: string[];
  skills: string[];
  riskLevel: string;
  riskTags: string[];
  cleanReportCount: number;
  durationBaseline: number | null;
  cooperationStatus: string | null;
  // 仅 MCN 员工可见的内部字段
  riskReason?: string | null;
  blacklistReason?: string | null;
  operationNote?: string | null;
  internal: boolean;
};

function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

export function summarizeStreamerProfile(
  profile: Record<string, unknown>,
  role: AppRole,
): StreamerProfileSummary {
  const baseline = pick(profile, "durationBaseline", "duration_baseline");
  const base: StreamerProfileSummary = {
    displayName: String(pick(profile, "displayName", "display_name") ?? "未设置昵称"),
    categories: toArray(pick(profile, "categories")),
    platforms: toArray(pick(profile, "platforms")),
    styles: toArray(pick(profile, "styles")),
    skills: toArray(pick(profile, "skills")),
    riskLevel: String(pick(profile, "riskLevel", "risk_level") ?? "low"),
    riskTags: toArray(pick(profile, "riskTags", "risk_tags")),
    cleanReportCount: toNumber(pick(profile, "cleanReportCount", "clean_report_count")),
    durationBaseline: baseline === undefined ? null : toNumber(baseline),
    cooperationStatus:
      (pick(profile, "cooperationStatus", "cooperation_status") as string) ?? null,
    internal: false,
  };

  if (role === "streamer") {
    // 主播端脱敏：不返回内部风控原因 / 运营备注 / 价格字段。
    return base;
  }
  return {
    ...base,
    internal: true,
    riskReason: (pick(profile, "riskReason", "risk_reason") as string) ?? null,
    blacklistReason:
      (pick(profile, "blacklistReason", "blacklist_reason") as string) ?? null,
    operationNote:
      (pick(profile, "operationNote", "operation_note") as string) ?? null,
  };
}

export function profileSummaryText(summary: StreamerProfileSummary): string {
  const parts = [
    `品类 ${summary.categories.join("/") || "—"}`,
    `平台 ${summary.platforms.join("/") || "—"}`,
    `风险 ${summary.riskLevel}`,
    `干净报数 ${summary.cleanReportCount} 场`,
  ];
  return `${summary.displayName}：${parts.join(" · ")}。`;
}
