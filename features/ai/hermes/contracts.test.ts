import { describe, expect, it } from "vitest";

import {
  HERMES_AUDIENCE,
  HERMES_BUILTIN_SKILLS_SHA256,
  HERMES_CAPABILITY_MANIFEST_SHA256,
  HERMES_KERNEL_ID,
  HERMES_MODE_BUDGETS,
  HERMES_OUTCOMES,
  HERMES_PROFILE_VERSION,
  HERMES_PROTOCOL_VERSION,
  LEGACY_HERMES_KERNEL_ID,
  LEGACY_HERMES_PROFILE_VERSION,
  XINGYAO_PRODUCT_ISSUER,
  isHermesActorProfile,
  isKnownHermesActorProfile,
  isLegacyHermesActorProfile,
  isHermesOutcome,
} from "./contracts";

describe("Hermes internal contracts", () => {
  it("pins Gateway v2 identity, budgets, and terminal outcomes", () => {
    expect(HERMES_KERNEL_ID).toBe("hermes-agent-official-gateway");
    expect(HERMES_PROTOCOL_VERSION).toBe("xingyao-hermes-gateway-v2");
    expect(HERMES_BUILTIN_SKILLS_SHA256).toBe(
      "c1755ec71e802748d518c2a27c81d429c95f8e31b1b82ab77d966e60469c9239",
    );
    expect(HERMES_CAPABILITY_MANIFEST_SHA256).toBe(
      "f7a47f72f5f2c5d93f3f8510b5b744f59c8937508b32c75d6556484a19d8a5e7",
    );
    expect(HERMES_PROFILE_VERSION).toBe("hermes-xingyao-v2");
    expect(LEGACY_HERMES_KERNEL_ID).toBe("hermes-agent-fork");
    expect(LEGACY_HERMES_PROFILE_VERSION).toBe(
      "hermes-xingyao-v1+skills.c1755ec71e802748",
    );
    expect(HERMES_MODE_BUDGETS.fast).toEqual({
      maxIterations: 24,
      wallClockMs: 90_000,
      maxParallelSubagents: 1,
      maxSubagentDepth: 1,
    });
    expect(HERMES_MODE_BUDGETS.deep).toEqual({
      maxIterations: 90,
      wallClockMs: 300_000,
      maxParallelSubagents: 3,
      maxSubagentDepth: 2,
    });
    expect(HERMES_OUTCOMES).toEqual([
      "complete",
      "partial",
      "blocked",
      "failed",
      "cancelled",
    ]);
    expect(XINGYAO_PRODUCT_ISSUER).toBe("xingyao-product");
    expect(HERMES_AUDIENCE).toBe("xingyao-hermes-agent");
  });

  it("accepts only exact actor profile fields", () => {
    const profile = {
      userId: UUID_A,
      organizationId: UUID_B,
      role: "owner",
      conversationId: UUID_C,
      invocationId: UUID_D,
      allowedReadScopes: ["context.read"],
      enabledSkillVersions: [],
      skillGrantsHash:
        "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      profileVersion: "hermes-xingyao-v2",
      pageContext: { pageType: "project", objectIds: [UUID_D] },
    };

    expect(isHermesActorProfile(profile)).toBe(true);
    expect(
      isHermesActorProfile({ ...profile, organizationName: "client injected" }),
    ).toBe(false);
    expect(isHermesActorProfile({ ...profile, role: "admin" })).toBe(false);
    expect(isHermesActorProfile({ ...profile, userId: "not-a-uuid" })).toBe(
      false,
    );
    expect(
      isHermesActorProfile({
        ...profile,
        allowedReadScopes: ["context.read", "settlements.write"],
      }),
    ).toBe(false);
    expect(
      isHermesActorProfile({ ...profile, skillGrantsHash: "not-a-sha256" }),
    ).toBe(false);

    const legacyProfile = {
      ...profile,
      profileVersion: "hermes-xingyao-v1+skills.c1755ec71e802748",
    };
    expect(isHermesActorProfile(legacyProfile)).toBe(false);
    expect(isLegacyHermesActorProfile(legacyProfile)).toBe(true);
    expect(isKnownHermesActorProfile(profile)).toBe(true);
    expect(isKnownHermesActorProfile(legacyProfile)).toBe(true);
    expect(
      isKnownHermesActorProfile({ ...profile, profileVersion: "custom" }),
    ).toBe(false);
  });

  it("rejects outcomes outside the closed terminal set", () => {
    expect(isHermesOutcome("partial")).toBe(true);
    expect(isHermesOutcome("timed_out")).toBe(false);
  });
});

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
const UUID_D = "44444444-4444-4444-8444-444444444444";
