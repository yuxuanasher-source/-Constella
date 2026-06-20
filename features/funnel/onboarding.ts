import type { BillingActor } from "@/features/billing/billing-write-guard";

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
