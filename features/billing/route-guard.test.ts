import { describe, expect, it, vi } from "vitest";

import { buildBillingStatus } from "./billing-status";
import {
  assertBillingWriteAllowed,
  assertWriteAllowedFromBillingStatus,
} from "./route-guard";

const activeBilling = buildBillingStatus({
  subscription: {
    status: "active",
    plan: { tier: "pro", code: "pro", name: "Pro" },
  },
  featureAddons: [],
  usageCounters: [],
});

const pastDueBilling = buildBillingStatus({
  subscription: {
    status: "past_due",
    plan: { tier: "pro", code: "pro", name: "Pro" },
  },
  featureAddons: [],
  usageCounters: [],
});

describe("billing route guard", () => {
  it("allows writes while the organization billing mode is active", () => {
    expect(() =>
      assertWriteAllowedFromBillingStatus({
        billing: activeBilling,
        featureKey: "project_management",
      }),
    ).not.toThrow();
  });

  it("blocks writes when the organization is in past-due read-only mode", () => {
    expect(() =>
      assertWriteAllowedFromBillingStatus({
        billing: pastDueBilling,
        featureKey: "project_management",
      }),
    ).toThrow("Organization is read-only because billing is past due");
  });

  it("loads billing status before allowing a route write", async () => {
    const client = { client: "supabase" };
    const getBillingStatus = vi.fn().mockResolvedValue(activeBilling);

    await assertBillingWriteAllowed({
      client: client as never,
      organizationId: "org-1",
      featureKey: "project_management",
      getBillingStatus,
    });

    expect(getBillingStatus).toHaveBeenCalledWith({
      client,
      organizationId: "org-1",
      now: undefined,
    });
  });
});
