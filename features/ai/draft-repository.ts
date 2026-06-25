// ai_drafts 持久化（走 RLS：仅本组织 MCN 员工）。L2 草稿落点，不影响主流程；
// confirm/discard 由人触发，confirmed_by 记录确认人（审计）。

import type { AiDraftEnvelope } from "./drafts";

type InsertResult = { data: { id: string }[] | null; error: unknown };
type MutateResult = { error: unknown };

export type DraftClient = {
  from(table: "ai_drafts"): {
    insert(
      payload: Record<string, unknown>,
    ): { select(columns: string): PromiseLike<InsertResult> };
    update(payload: Record<string, unknown>): {
      eq(column: string, value: string): {
        eq(column: string, value: string): PromiseLike<MutateResult>;
      };
    };
  };
};

export type CreateAiDraftInput = {
  organizationId: string;
  actingUserId: string;
  aiInvocationId?: string | null;
  envelope: AiDraftEnvelope;
};

export async function createAiDraft(
  client: DraftClient,
  input: CreateAiDraftInput,
): Promise<{ id: string } | null> {
  const { data, error } = await client
    .from("ai_drafts")
    .insert({
      organization_id: input.organizationId,
      acting_user_id: input.actingUserId,
      ai_invocation_id: input.aiInvocationId ?? null,
      draft_type: input.envelope.draftType,
      target_state_machine: input.envelope.targetStateMachine,
      target_state: input.envelope.targetState,
      payload: input.envelope.payload,
      status: "pending",
    })
    .select("id");
  if (error || !data || !data[0]) return null;
  return { id: data[0].id };
}

// 人工确认：把 pending → confirmed，并记录 confirmed_by。只允许确认本组织内、
// 仍为 pending 的草稿（status='pending' 作为乐观并发护栏）。
export async function confirmAiDraft(
  client: DraftClient,
  input: { organizationId: string; draftId: string; confirmedBy: string },
): Promise<boolean> {
  const { error } = await client
    .from("ai_drafts")
    .update({
      status: "confirmed",
      confirmed_by: input.confirmedBy,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", input.draftId)
    .eq("organization_id", input.organizationId);
  return !error;
}

export async function discardAiDraft(
  client: DraftClient,
  input: { organizationId: string; draftId: string },
): Promise<boolean> {
  const { error } = await client
    .from("ai_drafts")
    .update({ status: "discarded" })
    .eq("id", input.draftId)
    .eq("organization_id", input.organizationId);
  return !error;
}
