import { describe, expect, it } from "vitest";

import { createMemoryBillingRepo } from "@/features/billing/billing-repo-memory";
import type { BillingRepo } from "@/features/billing/billing-repo";
import {
  TEST_ACTOR,
  TEST_PAYMENT_WEBHOOK_SECRET,
  TEST_PLANS,
  TEST_PRICES,
  makeSubscription,
} from "@/features/billing/billing-test-fixtures";
import { assertBillingWriteAllowed } from "@/features/billing/billing-write-guard";
import { createCheckoutOrder } from "@/features/billing/checkout";
import {
  buildSignedMockWebhook,
  createMockPaymentProvider,
} from "@/features/billing/providers/mock-provider";
import { calculateUsageStatus } from "@/features/billing/usage-metering";
import { handleWebhook } from "@/features/billing/webhooks";

const provider = createMockPaymentProvider({
  secret: TEST_PAYMENT_WEBHOOK_SECRET,
});
const NOW = new Date("2026-06-16T00:00:00.000Z");

async function payLatestOrder(
  repo: BillingRepo,
  orderId: string,
  amountCents: number,
  eventId: string,
) {
  const payload = buildSignedMockWebhook(
    {
      eventId,
      type: "payment",
      status: "succeeded",
      providerTxnId: `mock_pay_${orderId}`,
      orderId,
      amountCents,
    },
    TEST_PAYMENT_WEBHOOK_SECRET,
  );
  return handleWebhook({ repo, provider, ...payload, now: NOW });
}

describe("P6 payment closure regression", () => {
  it("runs new → upgrade → renewal through checkout and webhooks", async () => {
    const { repo, state } = createMemoryBillingRepo({
      plans: TEST_PLANS,
      prices: TEST_PRICES,
      subscription: makeSubscription({
        organizationId: "org-1",
        planId: "plan_trial",
        status: "trialing",
      }),
    });

    // 1. 首购 basic → 回调 → active
    const buy = await createCheckoutOrder({
      repo,
      provider,
      actor: TEST_ACTOR,
      intent: {
        kind: "subscription_new",
        target: { planCode: "basic", billingCycle: "monthly" },
      },
      now: NOW,
    });
    expect(buy.order.amountCents).toBe(29900);
    await payLatestOrder(repo, buy.order.id, 29900, "evt-new");
    expect(state.subscriptions.get("org-1")).toMatchObject({
      planId: "plan_basic",
      status: "active",
    });

    // 2. 升级 pro（补差立即生效）
    const upgrade = await createCheckoutOrder({
      repo,
      provider,
      actor: TEST_ACTOR,
      intent: {
        kind: "subscription_upgrade",
        target: { planCode: "pro", billingCycle: "monthly" },
      },
      now: NOW,
    });
    expect(upgrade.order.amountCents).toBeGreaterThan(0);
    await payLatestOrder(
      repo,
      upgrade.order.id,
      upgrade.order.amountCents,
      "evt-up",
    );
    expect(state.subscriptions.get("org-1")).toMatchObject({
      planId: "plan_pro",
      status: "active",
    });

    // 3. 续费 pro（顺延账期）
    const periodBefore = state.subscriptions.get("org-1")?.currentPeriodEnd;
    const renew = await createCheckoutOrder({
      repo,
      provider,
      actor: TEST_ACTOR,
      intent: {
        kind: "subscription_renewal",
        target: { planCode: "pro", billingCycle: "monthly" },
      },
      now: NOW,
    });
    await payLatestOrder(
      repo,
      renew.order.id,
      renew.order.amountCents,
      "evt-renew",
    );
    const periodAfter = state.subscriptions.get("org-1")?.currentPeriodEnd;
    expect(periodAfter).not.toBe(periodBefore);

    // one transaction row per provider payment (created → succeeded upsert)
    expect(
      state.transactions.filter((t) => t.status === "succeeded"),
    ).toHaveLength(3);
  });

  it("keeps read-only writes blocked and OCR overage hard-blocked", () => {
    expect(() => assertBillingWriteAllowed("readonly")).toThrow();
    const ocr = calculateUsageStatus({
      metric: "ocr",
      usedQuantity: 300,
      includedQuantity: 200,
      addonQuantity: 0,
    });
    expect(ocr.shouldHardBlock).toBe(true);
  });

  it("replays a webhook without double-charging the subscription", async () => {
    const { repo, state } = createMemoryBillingRepo({
      plans: TEST_PLANS,
      prices: TEST_PRICES,
      subscription: makeSubscription({
        organizationId: "org-1",
        planId: "plan_trial",
        status: "trialing",
      }),
    });
    const buy = await createCheckoutOrder({
      repo,
      provider,
      actor: TEST_ACTOR,
      intent: {
        kind: "subscription_new",
        target: { planCode: "pro", billingCycle: "monthly" },
      },
      now: NOW,
    });
    await payLatestOrder(repo, buy.order.id, 99900, "evt-1");
    const replay = await payLatestOrder(repo, buy.order.id, 99900, "evt-1");

    expect(replay).toMatchObject({ processed: false, reason: "duplicate" });
    expect(
      state.transactions.filter((t) => t.status === "succeeded"),
    ).toHaveLength(1);
  });
});
