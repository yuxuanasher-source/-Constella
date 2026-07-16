// AI 安全地基（对应《经营舱·AI 能力全套方案》第 2/4 节）。
// - 工具分层 tier（L1–L4）；L4 永不为 AI 注册（从工具表上就不存在）。
// - 状态机强制确认网关 aiAttemptTransition：是否需人工确认由「目标状态」元数据决定，
//   绝不由 AI 临场判断（铁律 2）。L4 一律 draft_only；需确认的一律 pending_confirmation。
//
// STATE_MACHINE_META 为 config-as-code，与迁移 20260626100000 的 state_machine_meta
// 种子同源；数据库表用于审计 / SQL 侧可观测，运行期网关逻辑以本文件为准。

export const AI_TIERS = [
  "L1_PERCEIVE",
  "L2_DRAFT",
  "L3_BOUNDED",
  "L4_FORBIDDEN",
] as const;
export type AiTier = (typeof AI_TIERS)[number];

export type StateMeta = {
  stateMachine: string;
  state: string;
  tier: AiTier;
  requiresHumanConfirm: boolean;
  financialImpact: boolean;
  isFrozen: boolean;
  highRiskAudit: boolean;
};

const meta = (
  stateMachine: string,
  state: string,
  tier: AiTier,
  requiresHumanConfirm = false,
  financialImpact = false,
  isFrozen = false,
  highRiskAudit = false,
): StateMeta => ({
  stateMachine,
  state,
  tier,
  requiresHumanConfirm,
  financialImpact,
  isFrozen,
  highRiskAudit,
});

export const STATE_MACHINE_META: readonly StateMeta[] = [
  // 结算状态机
  meta("settlement", "draft", "L2_DRAFT"),
  meta("settlement", "generated", "L3_BOUNDED", true),
  meta("settlement", "pending_confirm", "L3_BOUNDED", true),
  meta("settlement", "confirmed", "L4_FORBIDDEN", true, true, true, false),
  meta("settlement", "locked", "L4_FORBIDDEN", true, true, true, false),
  meta("settlement", "reopened", "L4_FORBIDDEN", true, true, false, true),
  meta("settlement", "exported", "L3_BOUNDED"),
  // 报数 / 证据三轨
  meta("report", "pending_review", "L3_BOUNDED", true),
  meta("report", "enter_settlement_pool", "L4_FORBIDDEN", true, true, true, false),
  meta("report", "green", "L4_FORBIDDEN", false, false, true, false),
  meta("report", "yellow", "L4_FORBIDDEN", false, false, true, false),
  meta("report", "red", "L4_FORBIDDEN", false, false, true, false),
  // 选播准入
  meta("onboarding", "recording_submitted", "L1_PERCEIVE"),
  meta("onboarding", "recording_approved", "L4_FORBIDDEN", true, true, true, false),
  meta("onboarding", "joined", "L4_FORBIDDEN", true, true, true, false),
  // 任务 / 异常处置（L3 受限执行）
  meta("task", "abnormal_ticket", "L3_BOUNDED"), // 创建异常工单：可逆，执行
  meta("task", "cancelled", "L3_BOUNDED", true), // 转取消终态：人工确认
  // 通知（L3 受限执行）
  meta("notification", "queued", "L3_BOUNDED"), // 低风险通知：执行
  meta("notification", "high_risk_sent", "L3_BOUNDED", true), // 高风险通知：人工确认
  // 主播项目复盘：AI 可生成草稿，正式发布 / 归档必须由人确认。
  meta("streamer_project_review", "published", "L4_FORBIDDEN", true, false, true, false),
];

export function findStateMeta(
  stateMachine: string,
  state: string,
): StateMeta | null {
  return (
    STATE_MACHINE_META.find(
      (m) => m.stateMachine === stateMachine && m.state === state,
    ) ?? null
  );
}

export type AiTransitionDecision = {
  decision: "draft_only" | "pending_confirmation" | "execute";
  tier: AiTier | "unknown";
  reason: string;
};

// 网关（对应方案 4.2 伪代码 ai_attempt_transition）：
// 1) 未知目标状态 → 安全兜底为「待人工确认」，绝不直接执行。
// 2) L4 禁区 → 只生成草稿，把按钮递给人（即便 AI 被注入/出错也碰不到不可逆按钮）。
// 3) 目标状态要求人工确认 → 停在待确认。
// 4) 其余可逆低风险 → 执行（调用方仍须全程审计）。
export function aiAttemptTransition(
  target: StateMeta | null,
): AiTransitionDecision {
  if (!target) {
    return {
      decision: "pending_confirmation",
      tier: "unknown",
      reason: "未知目标状态，安全兜底为待人工确认",
    };
  }
  if (target.tier === "L4_FORBIDDEN") {
    return {
      decision: "draft_only",
      tier: target.tier,
      reason: "L4 禁区：AI 仅生成草稿，确认权归人",
    };
  }
  if (target.requiresHumanConfirm) {
    return {
      decision: "pending_confirmation",
      tier: target.tier,
      reason: "目标状态要求人工确认",
    };
  }
  return {
    decision: "execute",
    tier: target.tier,
    reason: "可逆低风险，全程审计后执行",
  };
}

// 便捷重载：直接按 (stateMachine, state) 查元数据再裁决。
export function aiAttemptTransitionFor(
  stateMachine: string,
  state: string,
): AiTransitionDecision {
  return aiAttemptTransition(findStateMeta(stateMachine, state));
}

export function isForbiddenTier(tier: AiTier): boolean {
  return tier === "L4_FORBIDDEN";
}

// 注册护栏：L4 工具必须「根本不存在」，注册即抛错（比运行期拦截更强的防线）。
export function assertRegistrableTool(toolName: string, tier: AiTier): void {
  if (isForbiddenTier(tier)) {
    throw new Error(
      `AI tool "${toolName}" declares L4_FORBIDDEN tier and must never be registered`,
    );
  }
}
