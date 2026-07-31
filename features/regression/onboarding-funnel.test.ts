import { describe, expect, it } from "vitest";

import { buildBillingStatus } from "@/features/billing/billing-status";
import { createMemoryBillingRepo } from "@/features/billing/billing-repo-memory";
import {
  TEST_ACTOR,
  TEST_PAYMENT_WEBHOOK_SECRET,
  TEST_PLANS,
  TEST_PRICES,
  makeSubscription,
} from "@/features/billing/billing-test-fixtures";
import { parseCheckoutIntent } from "@/features/billing/checkout-intent";
import { createCheckoutOrder } from "@/features/billing/checkout";
import {
  buildSignedMockWebhook,
  createMockPaymentProvider,
} from "@/features/billing/providers/mock-provider";
import { handleWebhook } from "@/features/billing/webhooks";
import { isActivated } from "@/features/funnel/onboarding";
import { resolvePaywall } from "@/features/funnel/paywall";

const provider = createMockPaymentProvider({
  secret: TEST_PAYMENT_WEBHOOK_SECRET,
});
const NOW = new Date("2026-06-13T00:00:00.000Z");

describe("Self-serve funnel → P6 checkout handoff", () => {
  it("drives a trial org from onboarding through the paywall into an active subscription", async () => {
    // Onboarding: activation reached after core steps.
    expect(isActivated(["create_project", "add_streamer", "submit_report"])).toBe(
      true,
    );

    // Paywall reads the getBillingStatus conclusion (trial nearing expiry).
    const trialStatus = buildBillingStatus({
      subscription: {
        status: "trialing",
        plan: { tier: "free", code: "trial", name: "试用版" },
        trialEndsAt: "2026-06-15T00:00:00.000Z",
      },
      featureAddons: [],
      usageCounters: [],
    });
    expect(trialStatus.autoRenew).toBe(true);
    expect(trialStatus.pendingPlan).toBeNull();
    expect(resolvePaywall(trialStatus, { now: NOW })).toEqual({
      reason: "trial_ending",
      blocking: false,
    });

    // The paywall CTA only carries intent (plan + cycle), never money.
    const intent = parseCheckoutIntent({
      kind: "subscription_new",
      target: { planCode: "pro", billingCycle: "monthly" },
    });

    const { repo, state } = createMemoryBillingRepo({
      plans: TEST_PLANS,
      prices: TEST_PRICES,
      subscription: makeSubscription({
        organizationId: "org-1",
        planId: "plan_trial",
        status: "trialing",
      }),
    });

    const checkout = await createCheckoutOrder({
      repo,
      provider,
      actor: TEST_ACTOR,
      intent,
      now: NOW,
    });
    expect(checkout.order.amountCents).toBe(99900);

    const payload = buildSignedMockWebhook(
      {
        eventId: "evt-activate",
        type: "payment",
        status: "succeeded",
        providerTxnId: `mock_pay_${checkout.order.id}`,
        orderId: checkout.order.id,
        amountCents: 99900,
      },
      TEST_PAYMENT_WEBHOOK_SECRET,
    );
    const result = await handleWebhook({ repo, provider, ...payload, now: NOW });

    expect(result.processed).toBe(true);
    expect(state.subscriptions.get("org-1")).toMatchObject({
      planId: "plan_pro",
      status: "active",
    });
  });
});
