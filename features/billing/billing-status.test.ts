import { describe, expect, it } from "vitest";

import { buildBillingStatus } from "./billing-status";

describe("buildBillingStatus", () => {
  it("returns safe entitlements and usage status without payment economics", () => {
    const status = buildBillingStatus({
      subscription: {
        status: "active",
        plan: {
          tier: "basic",
          code: "basic-monthly",
          name: "基础版",
        },
      },
      featureAddons: [{ featureKey: "war_room", enabled: true }],
      usageCounters: [
        {
          metric: "ai",
          usedQuantity: 1300,
          includedQuantity: 1000,
          addonQuantity: 200,
        },
      ],
    });

    expect(status).toMatchObject({
      subscriptionStatus: "active",
      mode: "active",
      plan: {
        tier: "basic",
        code: "basic-monthly",
        name: "基础版",
      },
      entitlements: {
        project_management: true,
        war_room: true,
        ai_diagnosis: false,
      },
      usage: [
        {
          metric: "ai",
          overageQuantity: 100,
          softOverage: true,
          shouldHardBlock: false,
        },
      ],
    });
    expect(JSON.stringify(status)).not.toContain("amountCents");
    expect(JSON.stringify(status)).not.toContain("price");
  });
});
