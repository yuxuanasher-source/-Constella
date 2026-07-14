// Pure helpers for the external-cost (project cost item) entry + review panel
// (PRD §3.3). Options, status presentation and amount conversion live here so
// they can be unit-tested without the ops-reference monolith.

import { formatYuanFromCents } from "./settlement-reconciliation-view";

export { formatYuanFromCents };

export const COST_ITEM_TYPE_OPTIONS = [
  { value: "supplier_fee", label: "供应商费用" },
  { value: "traffic", label: "投流" },
  { value: "platform_fee", label: "平台抽成" },
  { value: "cpa", label: "CPA" },
  { value: "cps", label: "CPS" },
  { value: "gift", label: "礼物" },
  { value: "sample", label: "样品" },
  { value: "replay", label: "录屏/复盘" },
  { value: "bonus", label: "奖励" },
  { value: "penalty", label: "罚扣" },
  { value: "tax", label: "税费" },
  { value: "manual", label: "手工" },
];

export const COST_DIRECTION_OPTIONS = [
  { value: "cost", label: "成本" },
  { value: "revenue_offset", label: "冲减收入" },
  { value: "adjustment", label: "调整" },
];

export const COST_EVIDENCE_OPTIONS = [
  { value: "green", label: "绿（强证据）" },
  { value: "yellow", label: "黄（弱证据）" },
  { value: "red", label: "红（缺证据）" },
];

const STATUS_META = {
  draft: { tone: "neutral", label: "草稿" },
  pending_review: { tone: "amber", label: "待审核" },
  confirmed: { tone: "green", label: "已确认" },
  voided: { tone: "red", label: "已作废" },
};

export function costStatusTone(status) {
  return STATUS_META[status]?.tone ?? "neutral";
}

export function costStatusLabel(status) {
  return STATUS_META[status]?.label ?? status;
}

// A pending_review/draft item can be confirmed; anything not already voided can
// be voided. Mirrors the server-side assertCostItemTransition.
export function canConfirmCostItem(status) {
  return status === "pending_review" || status === "draft";
}

export function canVoidCostItem(status) {
  return status !== "voided";
}

// Convert a yuan input string/number into integer cents for the API. A blank
// or whitespace-only string is invalid (returns null) rather than coercing to
// 0, so an empty amount field surfaces a validation error instead of silently
// posting a zero-cost item.
export function yuanInputToCents(value) {
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }
  const yuan = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(yuan) || yuan < 0) {
    return null;
  }
  return Math.round(yuan * 100);
}

export function defaultCostDraft() {
  return {
    itemType: "supplier_fee",
    amountYuan: "",
    direction: "cost",
    evidenceLevel: "yellow",
    reason: "",
  };
}

// Build the POST /cost-items payload from a draft, or return an error string.
export function buildCostItemPayload(draft) {
  const amountCents = yuanInputToCents(draft.amountYuan);
  if (amountCents === null) {
    return { error: "请填写非负的金额" };
  }
  if (!draft.reason || !draft.reason.trim()) {
    return { error: "请填写录入原因" };
  }
  return {
    payload: {
      itemType: draft.itemType,
      amountCents,
      direction: draft.direction,
      evidenceLevel: draft.evidenceLevel,
      reason: draft.reason.trim(),
    },
  };
}
