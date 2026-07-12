import { describe, expect, it } from "vitest";

import { buildBillingStatus, getBillingStatus } from "./billing-status";

type SelectCall = {
  table: string;
  columns: string;
};

type FakeQuery = {
  select(columns: string): FakeQuery;
  eq(column: string, value: unknown): FakeQuery;
  maybeSingle(): Promise<{ data: unknown; error: null }>;
  returns(): Promise<{ data: unknown; error: null }>;
};

function makeBillingStatusClient() {
  const selectCalls: SelectCall[] = [];
  const dataByTable: Record<string, unknown> = {
    organization_subscriptions: {
      status: "active",
      auto_renew: true,
      grace_until: null,
      trial_ends_at: null,
      pending_plan_id: "plan-pro",
      billing_plans: {
        tier: "basic",
        code: "basic-monthly",
        name: "Basic",
      },
    },
    feature_addons: [],
    usage_monthly_counters: [],
    billing_plans: {
      code: "pro-monthly",
      name: "Pro",
    },
  };

  return {
    client: {
      from(table: string) {
        const query: FakeQuery = {
          select(columns) {
            selectCalls.push({ table, columns });
            return query;
          },
          eq() {
            return query;
          },
          maybeSingle() {
            return Promise.resolve({
              data: dataByTable[table] ?? null,
              error: null,
            });
          },
          returns() {
            return Promise.resolve({
              data: dataByTable[table] ?? null,
              error: null,
            });
          },
        };
        return query;
      },
    },
    selectCalls,
  };
}

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

describe("getBillingStatus", () => {
  it("binds the active plan relation without confusing the pending plan", async () => {
    const { client, selectCalls } = makeBillingStatusClient();

    const status = await getBillingStatus({
      client: client as never,
      organizationId: "org-1",
      now: new Date("2026-07-01T00:00:00.000Z"),
    });

    expect(selectCalls).toContainEqual({
      table: "organization_subscriptions",
      columns:
        "status, auto_renew, grace_until, trial_ends_at, pending_plan_id, billing_plans!organization_subscriptions_plan_id_fkey(tier, code, name)",
    });
    expect(status.plan).toEqual({
      tier: "basic",
      code: "basic-monthly",
      name: "Basic",
    });
    expect(status.pendingPlan).toEqual({
      code: "pro-monthly",
      name: "Pro",
    });
  });
});
