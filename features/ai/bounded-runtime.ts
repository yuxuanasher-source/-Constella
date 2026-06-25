// L3 受限执行的运行时落地（方案第 3.4 / 4.2 节）。把「异常工单 / 通知」这类 AI 触发
// 的状态推进统一经 runAiBoundedTransition 网关裁决：可逆低风险才执行（写真表 + 审计），
// 需人工确认 / L4 一律落 ai_drafts（pending），AI 碰不到不可逆按钮（铁律 2）。

import { createAiDraft, type DraftClient } from "./draft-repository";
import {
  runAiBoundedTransition,
  type BoundedActor,
  type BoundedDeps,
  type BoundedOutcome,
  type BoundedProposal,
} from "./bounded-gateway";
import { writeAuditLog, type AuditLogInput } from "@/lib/audit/audit";
import type { AppRole } from "@/lib/rbac/roles";

export type BoundedActionType = "notification" | "exception_ticket";

// 通知枚举（与迁移 notification_type 一致）。AI 受限执行只允许业务通知，不允许越权类型。
const NOTIFICATION_TYPES = new Set([
  "task",
  "review",
  "anomaly",
  "settlement",
  "system",
  "high_risk",
]);

export type BoundedActionInput = {
  actionType: BoundedActionType;
  isHighRisk?: boolean;
  recipientRole?: AppRole | null;
  recipientUserId?: string | null;
  notificationType?: string | null;
  title: string;
  content: string;
  taskId?: string | null;
};

// actionType → 状态机 + 目标状态。目标状态决定是否需人工确认（不由 AI 临场判断）。
export function resolveProposal(input: BoundedActionInput): BoundedProposal {
  if (input.actionType === "notification") {
    return {
      stateMachine: "notification",
      targetState: input.isHighRisk ? "high_risk_sent" : "queued",
      actionType: "notification",
      payload: {
        recipientRole: input.recipientRole ?? null,
        recipientUserId: input.recipientUserId ?? null,
        notificationType: input.notificationType ?? "system",
        title: input.title,
        content: input.content,
        isHighRisk: Boolean(input.isHighRisk),
      },
    };
  }
  // 异常工单：可逆（abnormal_ticket），以高风险通知投递给运营处置。
  return {
    stateMachine: "task",
    targetState: "abnormal_ticket",
    actionType: "exception_ticket",
    payload: {
      taskId: input.taskId ?? null,
      title: input.title,
      content: input.content,
    },
  };
}

export function validateBoundedInput(input: BoundedActionInput): string | null {
  if (input.actionType !== "notification" && input.actionType !== "exception_ticket") {
    return "Unsupported actionType";
  }
  if (!input.title?.trim() || !input.content?.trim()) {
    return "title and content are required";
  }
  if (input.actionType === "notification") {
    const type = input.notificationType ?? "system";
    if (!NOTIFICATION_TYPES.has(type)) return "Unsupported notificationType";
    if (!input.recipientRole && !input.recipientUserId) {
      return "recipientRole or recipientUserId is required";
    }
  }
  if (input.actionType === "exception_ticket" && !input.taskId) {
    return "taskId is required for exception_ticket";
  }
  return null;
}

// 真表写入 client（notifications 插入 + 审计）。最小接口，便于单测注入。
export type NotificationInsertClient = {
  from(table: "notifications"): {
    insert(payload: Record<string, unknown>): {
      select(columns: string): {
        single(): PromiseLike<{ data: { id: string } | null; error: unknown }>;
      };
    };
  };
};

export type BoundedRuntimeClient = NotificationInsertClient &
  DraftClient &
  Parameters<typeof writeAuditLog>[0];

type ExecuteResult = { id: string; channel: "notification" };

// execute：可逆低风险动作真正落库——把通知 / 异常工单写入 notifications 表 + 审计。
async function executeProposal(
  client: BoundedRuntimeClient,
  actor: BoundedActor,
  proposal: BoundedProposal,
): Promise<ExecuteResult> {
  const p = proposal.payload as Record<string, unknown>;
  const isTicket = proposal.actionType === "exception_ticket";
  const { data, error } = await client
    .from("notifications")
    .insert({
      organization_id: actor.organizationId,
      recipient_user_id: isTicket ? null : (p.recipientUserId ?? null),
      recipient_role: isTicket ? "owner" : (p.recipientRole ?? null),
      notification_type: isTicket ? "anomaly" : String(p.notificationType ?? "system"),
      status: "unread",
      title: String(p.title ?? ""),
      content: String(p.content ?? ""),
      object_type: isTicket ? "live_task" : null,
      object_id: isTicket ? (p.taskId ?? null) : null,
      source: "ai_bounded",
      is_high_risk: isTicket ? true : Boolean(p.isHighRisk),
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error("Failed to persist bounded action");
  }

  const high = isTicket || Boolean(p.isHighRisk);
  const audit: AuditLogInput = {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name ?? undefined,
    actorRole: actor.role as AppRole,
    action: "create",
    module: "ai",
    objectType: isTicket ? "exception_ticket" : "notification",
    objectId: data.id,
    objectName: String(p.title ?? ""),
    after: { stateMachine: proposal.stateMachine, targetState: proposal.targetState },
    changedFields: ["status"],
    isHighRisk: high,
  };
  if (high) {
    audit.reason = `AI 受限执行（${proposal.actionType}）：网关裁定可逆低风险，已审计落库`;
  }
  await writeAuditLog(client, audit);

  return { id: data.id, channel: "notification" };
}

// createPending / createDraft：落 ai_drafts(pending)，把确认按钮递给人；并写审计。
async function persistAsDraft(
  client: BoundedRuntimeClient,
  actor: BoundedActor,
  proposal: BoundedProposal,
  outcome: "pending_confirmation" | "draft_only",
): Promise<{ id: string }> {
  const created = await createAiDraft(client, {
    organizationId: actor.organizationId,
    actingUserId: actor.userId,
    envelope: {
      draftType: proposal.actionType,
      status: "pending",
      targetStateMachine: proposal.stateMachine,
      targetState: proposal.targetState,
      payload: proposal.payload,
      note:
        outcome === "draft_only"
          ? "AI 草稿：目标为 L4 禁区，确认权归人。"
          : "AI 草稿：目标状态要求人工确认，确认后才生效。",
    },
  });
  if (!created) {
    throw new Error("Failed to persist AI draft");
  }
  await writeAuditLog(client, {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name ?? undefined,
    actorRole: actor.role as AppRole,
    action: "create",
    module: "ai",
    objectType: "ai_draft",
    objectName: `${proposal.actionType}:${created.id}`,
    after: {
      outcome,
      stateMachine: proposal.stateMachine,
      targetState: proposal.targetState,
    },
    changedFields: ["ai_draft"],
  });
  return { id: created.id };
}

export function boundedDepsFor(
  client: BoundedRuntimeClient,
  actor: BoundedActor,
): BoundedDeps<ExecuteResult> {
  return {
    execute: (proposal) => executeProposal(client, actor, proposal),
    createPending: (proposal) =>
      persistAsDraft(client, actor, proposal, "pending_confirmation"),
    createDraft: (proposal) =>
      persistAsDraft(client, actor, proposal, "draft_only"),
  };
}

// 一站式：校验 → 解析提案 → 经网关裁决执行 / 落待确认 / 落草稿。
export async function runBoundedAction(
  client: BoundedRuntimeClient,
  actor: BoundedActor,
  input: BoundedActionInput,
): Promise<BoundedOutcome<ExecuteResult>> {
  const proposal = resolveProposal(input);
  return runAiBoundedTransition(proposal, actor, boundedDepsFor(client, actor));
}
