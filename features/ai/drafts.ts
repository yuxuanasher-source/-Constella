// L2 草稿（方案第 2 / 3.4 / 3.5 节）。AI 只生成草稿写入 ai_drafts（pending），
// 不影响主流程；人在草稿上确认才生效（铁律 2）。本层是确定性构建器（可单测），
// 数字溯源：金额来自结构化输入并保留口径；CPT 口径与规则引擎同源（仅绿+系统）。

import {
  aiAttemptTransitionFor,
  type AiTransitionDecision,
} from "./tiers";
import type { KnowledgeCitation } from "./knowledge-base";

export type DraftStatus = "pending" | "confirmed" | "discarded";

export type AiDraftEnvelope = {
  draftType: string;
  status: "pending";
  targetStateMachine: string;
  targetState: string;
  payload: Record<string, unknown>;
  note: string;
};

export type SuggestedActionTodoDraftInput = {
  actionId: string;
  projectId?: string;
  projectName?: string;
  priority: "high" | "medium" | "low";
  title: string;
  rationale?: string;
  evidence?: Array<{ sourceTool: string; sourceId: string }>;
  target?: { route?: string; id?: string };
  requiresHumanApproval?: boolean;
};

// ===== 结算批次草稿（确定性聚合，按项目×周期、应付/应收分离）=====
export type SettlementPoolItem = {
  id?: string;
  projectId?: string | null;
  projectName?: string | null;
  streamerName?: string | null;
  evidenceLevel?: "green" | "yellow" | "red" | null;
  timeSource?: "system" | "screenshot" | "claimed" | null;
  payableCents?: number | null;
  receivableCents?: number | null;
  expectedAmount?: number | null;
};

// CPT 口径与规则引擎一致：仅「绿 + 系统时间源」可计 CPT。
export function isCptEligible(item: SettlementPoolItem): boolean {
  return item.evidenceLevel === "green" && item.timeSource === "system";
}

const cents = (value: number | null | undefined): number =>
  Number.isFinite(value as number) ? Math.round(value as number) : 0;

export function buildSettlementBatchDraft(
  items: SettlementPoolItem[],
  scope: { periodStart?: string; periodEnd?: string; batchType?: string },
): AiDraftEnvelope {
  const groups = new Map<
    string,
    {
      projectId: string | null;
      projectName: string;
      itemCount: number;
      payableCents: number;
      receivableCents: number;
      cptEligibleCount: number;
      weakEvidenceCount: number;
      weakEvidenceCents: number;
    }
  >();

  for (const item of items ?? []) {
    const key = String(item.projectId ?? item.projectName ?? "—");
    const payable = cents(item.payableCents ?? item.expectedAmount);
    const receivable = cents(item.receivableCents);
    const group =
      groups.get(key) ??
      {
        projectId: item.projectId ?? null,
        projectName: String(item.projectName ?? "未标注项目"),
        itemCount: 0,
        payableCents: 0,
        receivableCents: 0,
        cptEligibleCount: 0,
        weakEvidenceCount: 0,
        weakEvidenceCents: 0,
      };
    group.itemCount += 1;
    group.payableCents += payable;
    group.receivableCents += receivable;
    if (isCptEligible(item)) {
      group.cptEligibleCount += 1;
    } else {
      group.weakEvidenceCount += 1;
      group.weakEvidenceCents += payable;
    }
    groups.set(key, group);
  }

  const groupList = [...groups.values()].sort((a, b) =>
    a.projectName.localeCompare(b.projectName),
  );
  const totals = groupList.reduce(
    (acc, g) => ({
      itemCount: acc.itemCount + g.itemCount,
      payableCents: acc.payableCents + g.payableCents,
      receivableCents: acc.receivableCents + g.receivableCents,
      cptEligibleCount: acc.cptEligibleCount + g.cptEligibleCount,
      weakEvidenceCount: acc.weakEvidenceCount + g.weakEvidenceCount,
      weakEvidenceCents: acc.weakEvidenceCents + g.weakEvidenceCents,
    }),
    {
      itemCount: 0,
      payableCents: 0,
      receivableCents: 0,
      cptEligibleCount: 0,
      weakEvidenceCount: 0,
      weakEvidenceCents: 0,
    },
  );

  return {
    draftType: "settlement_batch",
    status: "pending",
    targetStateMachine: "settlement",
    targetState: "confirmed",
    payload: { scope, groups: groupList, totals },
    note: "AI 草稿：按项目×周期、应付/应收分离；弱证据(黄/红)仅承载不计 CPT。需人工确认后生成正式批次。",
  };
}

// ===== 复盘初稿（结构化框架，数字溯源；叙述只给提示不编造）=====
export function buildSuggestedActionTodoDraft(
  action: SuggestedActionTodoDraftInput,
): AiDraftEnvelope {
  return {
    draftType: "suggested_action_todo",
    status: "pending",
    targetStateMachine: "operations_todo",
    targetState: "created",
    payload: {
      sourceActionId: String(action.actionId || ""),
      ...(action.projectId ? { projectId: action.projectId } : {}),
      ...(action.projectName ? { projectName: action.projectName } : {}),
      priority: action.priority,
      title: action.title,
      rationale: action.rationale ?? "",
      evidence: action.evidence ?? [],
      route: action.target?.route ?? null,
      targetId: action.target?.id ?? null,
      requiresHumanApproval: action.requiresHumanApproval !== false,
    },
    note: "AI suggested action todo draft. Human confirmation is required before it becomes an operational task.",
  };
}

export type RetrospectiveMetric = {
  label: string;
  value: string;
  unit?: string;
  sourceRef: string;
};

export function buildRetrospectiveDraft(input: {
  periodLabel: string;
  metrics: RetrospectiveMetric[];
  references?: KnowledgeCitation[];
}): AiDraftEnvelope {
  const sections = [
    { key: "revenue", title: "收入与毛利", prompt: "本期厂家应收、主播应付、毛利与毛利率如何？环比变化与主要驱动？" },
    { key: "delivery", title: "履约与执行", prompt: "排班完成率、开播率、异常任务与处置时长？" },
    { key: "evidence", title: "证据与结算", prompt: "三轨颜色分布、弱证据金额、CPT 计入比例？" },
    { key: "streamer", title: "主播表现", prompt: "高/低 ROI 主播、画像匹配度、需复盘的个案？" },
    { key: "next", title: "下一步动作", prompt: "排班/预算倾斜、报价调整、招募补位的具体建议？" },
  ];
  return {
    draftType: "retrospective",
    status: "pending",
    targetStateMachine: "retrospective",
    targetState: "published",
    payload: {
      periodLabel: input.periodLabel,
      // 数字溯源：每个指标保留 sourceRef；叙述留空待人工补全，AI 不编造数字。
      metrics: (input.metrics ?? []).map((m) => ({ ...m })),
      sections,
      references: input.references ?? [],
    },
    note: "AI 复盘初稿：数字均带来源，叙述为提示性问题待人工补全。需人工确认后发布。",
  };
}

// 草稿对应的人工确认要求：经状态机网关裁决（L4 目标 → AI 只能出草稿，确认归人）。
export function draftConfirmationRequirement(
  draft: Pick<AiDraftEnvelope, "targetStateMachine" | "targetState">,
): AiTransitionDecision {
  return aiAttemptTransitionFor(draft.targetStateMachine, draft.targetState);
}
