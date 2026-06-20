export type FunnelEventName =
  | "landing_view"
  | "pricing_view"
  | "signup_started"
  | "signup_completed"
  | "onboarding_step_completed"
  | "activated"
  | "first_settlement_batch"
  | "paywall_shown"
  | "paywall_cta_clicked"
  | "checkout_started"
  | "subscription_activated"
  | "trial_ending_notified"
  | "trial_expired";

type FunnelEventClient = {
  from(table: "funnel_events"): {
    insert(
      payload: Record<string, unknown>,
    ): PromiseLike<{ error: Error | null }>;
  };
};

export type FunnelEventInput = {
  event: FunnelEventName;
  organizationId?: string | null;
  userId?: string | null;
  anonymousId?: string | null;
  reason?: string;
  variant?: string;
  properties?: Record<string, unknown>;
};

/**
 * 写一条漏斗埋点事件。注册前事件用 anonymousId（org 为空，经 service role 写入），
 * 注册成功后回填 organizationId / userId。
 */
export async function recordFunnelEvent(
  client: FunnelEventClient,
  input: FunnelEventInput,
): Promise<void> {
  const { error } = await client.from("funnel_events").insert({
    organization_id: input.organizationId ?? null,
    user_id: input.userId ?? null,
    anonymous_id: input.anonymousId ?? null,
    event: input.event,
    reason: input.reason ?? null,
    variant: input.variant ?? null,
    properties: input.properties ?? {},
  });

  if (error) {
    throw error;
  }
}
