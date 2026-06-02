import { describe, expect, it } from "vitest";

import {
  evaluateBillingGate,
  resolvePlanEntitlements,
} from "./billing-gates";

describe("resolvePlanEntitlements", () => {
  it("combines plan features with feature add-ons", () => {
    const entitlements = resolvePlanEntitlements({
      planTier: "basic",
      featureAddons: [{ featureKey: "war_room", enabled: true }],
    });

    expect(entitlements).toMatchObject({
      project_management: true,
      settlement: true,
      export_center: false,
      war_room: true,
      auto_review_active: false,
      ai_diagnosis: false,
    });
  });

  it("enables professional features on pro and enterprise plans", () => {
    expect(
      resolvePlanEntitlements({ planTier: "pro", featureAddons: [] }),
    ).toMatchObject({
      export_center: true,
      war_room: true,
      auto_review_shadow: true,
      ai_diagnosis: true,
    });

    expect(
      resolvePlanEntitlements({ planTier: "enterprise", featureAddons: [] }),
    ).toMatchObject({
      auto_review_active: true,
      vendor_portal: true,
      private_deployment: true,
    });
  });
});

describe("evaluateBillingGate", () => {
  it("allows reads but blocks writes for past-due organizations", () => {
    const entitlements = resolvePlanEntitlements({
      planTier: "pro",
      featureAddons: [],
    });

    expect(
      evaluateBillingGate({
        entitlements,
        subscriptionStatus: "past_due",
        featureKey: "settlement",
        action: "read",
      }),
    ).toEqual({ allowed: true, mode: "read_only" });

    expect(
      evaluateBillingGate({
        entitlements,
        subscriptionStatus: "past_due",
        featureKey: "settlement",
        action: "write",
      }),
    ).toEqual({
      allowed: false,
      mode: "read_only",
      reason: "subscription_readonly",
    });
  });

  it("blocks features missing from plan and add-ons", () => {
    const entitlements = resolvePlanEntitlements({
      planTier: "basic",
      featureAddons: [],
    });

    expect(
      evaluateBillingGate({
        entitlements,
        subscriptionStatus: "active",
        featureKey: "war_room",
        action: "read",
      }),
    ).toEqual({
      allowed: false,
      mode: "active",
      reason: "feature_not_entitled",
    });
  });
});
