// L2 草稿的纯展示层助手（可单测）。仅做标签映射与金额格式化、从结构化 payload
// 读出展示行——不改动数字口径（数字来自草稿构建器，溯源保留）。AI 不参与展示逻辑。

import type { AiDraftListItem } from "./draft-repository";

export const DRAFT_TYPE_LABELS: Record<string, string> = {
  settlement_batch: "结算批次",
  retrospective: "经营复盘",
};

export function draftTypeLabel(type: string): string {
  return DRAFT_TYPE_LABELS[type] ?? type;
}

export const DRAFT_STATUS_LABELS: Record<string, string> = {
  pending: "待确认",
  confirmed: "已确认",
  discarded: "已弃用",
};

export function draftStatusLabel(status: string): string {
  return DRAFT_STATUS_LABELS[status] ?? status;
}

// 分（cents）→ 「¥1,234.56」。口径与规则引擎一致：整数分，不做四舍五入改写。
export function formatYuan(cents: number | null | undefined): string {
  const value = Number.isFinite(cents as number) ? (cents as number) : 0;
  return `¥${(value / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const toInt = (value: unknown): number =>
  Number.isFinite(value as number) ? Math.round(value as number) : 0;

export type SettlementGroupView = {
  projectName: string;
  itemCount: number;
  payableCents: number;
  receivableCents: number;
  cptEligibleCount: number;
  weakEvidenceCount: number;
  weakEvidenceCents: number;
};

export type SettlementTotalsView = Omit<SettlementGroupView, "projectName">;

export type SettlementDraftView = {
  scope: { periodStart?: string; periodEnd?: string; batchType?: string };
  groups: SettlementGroupView[];
  totals: SettlementTotalsView;
};

// 从 settlement_batch 草稿 payload 读出展示视图（防御性读取，缺字段补 0）。
export function readSettlementDraft(
  payload: Record<string, unknown>,
): SettlementDraftView {
  const scope = (payload?.scope as SettlementDraftView["scope"]) ?? {};
  const rawGroups = Array.isArray(payload?.groups)
    ? (payload.groups as Record<string, unknown>[])
    : [];
  const groups: SettlementGroupView[] = rawGroups.map((g) => ({
    projectName: String(g?.projectName ?? "未标注项目"),
    itemCount: toInt(g?.itemCount),
    payableCents: toInt(g?.payableCents),
    receivableCents: toInt(g?.receivableCents),
    cptEligibleCount: toInt(g?.cptEligibleCount),
    weakEvidenceCount: toInt(g?.weakEvidenceCount),
    weakEvidenceCents: toInt(g?.weakEvidenceCents),
  }));
  const rawTotals = (payload?.totals as Record<string, unknown>) ?? {};
  const totals = {
    itemCount: toInt(rawTotals?.itemCount),
    payableCents: toInt(rawTotals?.payableCents),
    receivableCents: toInt(rawTotals?.receivableCents),
    cptEligibleCount: toInt(rawTotals?.cptEligibleCount),
    weakEvidenceCount: toInt(rawTotals?.weakEvidenceCount),
    weakEvidenceCents: toInt(rawTotals?.weakEvidenceCents),
  };
  return { scope, groups, totals };
}

export type RetrospectiveMetricView = {
  label: string;
  value: string;
  unit?: string;
  sourceRef: string;
};

export type RetrospectiveDraftView = {
  periodLabel: string;
  metrics: RetrospectiveMetricView[];
  sections: { key: string; title: string; prompt: string }[];
};

export function readRetrospectiveDraft(
  payload: Record<string, unknown>,
): RetrospectiveDraftView {
  const metrics = Array.isArray(payload?.metrics)
    ? (payload.metrics as Record<string, unknown>[]).map((m) => ({
        label: String(m?.label ?? ""),
        value: String(m?.value ?? ""),
        unit: m?.unit ? String(m.unit) : undefined,
        sourceRef: String(m?.sourceRef ?? ""),
      }))
    : [];
  const sections = Array.isArray(payload?.sections)
    ? (payload.sections as Record<string, unknown>[]).map((s) => ({
        key: String(s?.key ?? ""),
        title: String(s?.title ?? ""),
        prompt: String(s?.prompt ?? ""),
      }))
    : [];
  return {
    periodLabel: String(payload?.periodLabel ?? ""),
    metrics,
    sections,
  };
}

// 草稿一句话摘要（列表用）。数字来自结构化 totals，不臆造。
export function draftHeadline(draft: AiDraftListItem): string {
  if (draft.draftType === "settlement_batch") {
    const { groups, totals } = readSettlementDraft(draft.payload);
    const typeLabel = draft.payload?.scope
      ? (draft.payload.scope as { batchType?: string }).batchType ===
        "receivable"
        ? "应收"
        : "应付"
      : "应付";
    const amount =
      typeLabel === "应收" ? totals.receivableCents : totals.payableCents;
    return `${groups.length} 个项目 · ${totals.itemCount} 条 · ${typeLabel} ${formatYuan(amount)}`;
  }
  if (draft.draftType === "retrospective") {
    const { periodLabel, metrics } = readRetrospectiveDraft(draft.payload);
    return `${periodLabel || "复盘"} · ${metrics.length} 项指标`;
  }
  return draftTypeLabel(draft.draftType);
}
