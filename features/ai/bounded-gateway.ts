// L3 受限执行的「状态变更入口」运行时（方案第 4.2 节 ai_attempt_transition 落地）。
// 任何 AI 触发的状态机推进都经此兜底：是否需人工确认由「目标状态」元数据决定，
// 绝不由 AI 临场判断（铁律 2）。
// - L4 禁区 → 只落草稿（execute / createPending 都不调用）。
// - 需人工确认 → 落待确认（execute 不调用）。
// - 其余可逆低风险 → 执行（带审计）。
// 即便 AI 失控 / 被注入，最多停在草稿 / 待确认层，碰不到不可逆按钮。

import { aiAttemptTransitionFor, type AiTransitionDecision } from "./tiers";

export type BoundedActor = {
  userId: string;
  name?: string | null;
  role: string;
  organizationId: string;
};

export type BoundedProposal = {
  stateMachine: string;
  targetState: string;
  actionType: string; // 'exception_ticket' | 'notification' | ...
  payload: Record<string, unknown>;
};

export type BoundedDeps<T> = {
  // 真正执行可逆低风险动作（内部必须写审计）。
  execute: (proposal: BoundedProposal, actor: BoundedActor) => Promise<T>;
  // 落待确认（不执行动作本身），返回引用。
  createPending: (
    proposal: BoundedProposal,
    actor: BoundedActor,
  ) => Promise<{ id: string }>;
  // L4 目标：落草稿，把确认按钮递给人。
  createDraft: (
    proposal: BoundedProposal,
    actor: BoundedActor,
  ) => Promise<{ id: string }>;
};

export type BoundedOutcome<T> =
  | { outcome: "executed"; decision: AiTransitionDecision; result: T }
  | { outcome: "pending_confirmation"; decision: AiTransitionDecision; ref: { id: string } }
  | { outcome: "draft_only"; decision: AiTransitionDecision; ref: { id: string } };

export async function runAiBoundedTransition<T>(
  proposal: BoundedProposal,
  actor: BoundedActor,
  deps: BoundedDeps<T>,
): Promise<BoundedOutcome<T>> {
  const decision = aiAttemptTransitionFor(proposal.stateMachine, proposal.targetState);

  if (decision.decision === "draft_only") {
    const ref = await deps.createDraft(proposal, actor);
    return { outcome: "draft_only", decision, ref };
  }
  if (decision.decision === "pending_confirmation") {
    const ref = await deps.createPending(proposal, actor);
    return { outcome: "pending_confirmation", decision, ref };
  }
  const result = await deps.execute(proposal, actor);
  return { outcome: "executed", decision, result };
}
