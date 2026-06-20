import type { SupabaseClient } from "@supabase/supabase-js";

import type { BillingActor } from "@/features/billing/billing-write-guard";

import { recordFunnelEvent } from "./funnel-events";

export type OnboardingStep =
  | "create_project"
  | "add_streamer"
  | "schedule_live"
  | "submit_report"
  | "view_settlement"
  | "invite_member";

/**
 * 激活定义：建项目 + 加主播 + （排一场 或 报一次数）。
 * 业务动作的服务层「顺带」写入进度，前端不单独维护。
 */
export const ACTIVATION_REQUIRED_STEPS: OnboardingStep[] = [
  "create_project",
  "add_streamer",
];
export const ACTIVATION_ANY_OF_STEPS: OnboardingStep[] = [
  "schedule_live",
  "submit_report",
];

export function isActivated(completedSteps: OnboardingStep[]): boolean {
  const set = new Set(completedSteps);
  const hasRequired = ACTIVATION_REQUIRED_STEPS.every((step) => set.has(step));
  const hasAnyOf = ACTIVATION_ANY_OF_STEPS.some((step) => set.has(step));
  return hasRequired && hasAnyOf;
}

type OnboardingClient = {
  from(table: "onboarding_progress"): {
    upsert(
      payload: Record<string, unknown>,
      options: { onConflict: string; ignoreDuplicates: boolean },
    ): PromiseLike<{ error: Error | null }>;
  };
};

/**
 * 幂等记录一个 onboarding 步骤（同 org + step 不重复）。
 */
export async function markOnboardingStep({
  client,
  actor,
  step,
}: {
  client: OnboardingClient;
  actor: BillingActor;
  step: OnboardingStep;
}): Promise<void> {
  const { error } = await client.from("onboarding_progress").upsert(
    {
      organization_id: actor.organizationId,
      step,
      completed_by: actor.userId,
    },
    { onConflict: "organization_id,step", ignoreDuplicates: true },
  );
  if (error) {
    throw error;
  }
}

/**
 * 业务动作的服务层「顺带」记录 onboarding 进度：标记步骤 + 落
 * onboarding_step_completed 埋点；当本步跨过激活阈值时再落 activated 埋点。
 * 调用方应以 best-effort 方式包裹（失败不阻断主业务动作）。
 */
export async function recordOnboardingProgress({
  client,
  actor,
  step,
}: {
  client: SupabaseClient;
  actor: BillingActor;
  step: OnboardingStep;
}): Promise<{ activated: boolean; newlyActivated: boolean }> {
  const { data } = await client
    .from("onboarding_progress")
    .select("step")
    .eq("organization_id", actor.organizationId)
    .returns<{ step: OnboardingStep }[]>();
  const before = (data ?? []).map((row) => row.step);
  const wasActivated = isActivated(before);

  await markOnboardingStep({ client: client as never, actor, step });

  const after = before.includes(step) ? before : [...before, step];
  const activated = isActivated(after);
  const newlyActivated = activated && !wasActivated;

  await recordFunnelEvent(client as never, {
    event: "onboarding_step_completed",
    organizationId: actor.organizationId,
    userId: actor.userId,
    properties: { step },
  });
  if (newlyActivated) {
    await recordFunnelEvent(client as never, {
      event: "activated",
      organizationId: actor.organizationId,
      userId: actor.userId,
    });
  }

  return { activated, newlyActivated };
}
