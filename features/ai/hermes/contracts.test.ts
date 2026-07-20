import { describe, expect, it } from "vitest";

import {
  HERMES_AUDIENCE,
  HERMES_KERNEL_ID,
  HERMES_PROFILE_VERSION,
  XINGYAO_PRODUCT_ISSUER,
  isHermesActorProfile,
} from "./contracts";

describe("Hermes internal contracts", () => {
  it("pins the internal kernel identity and actor profile constants", () => {
    expect(HERMES_KERNEL_ID).toBe("hermes-agent-fork");
    expect(HERMES_PROFILE_VERSION).toBe("hermes-xingyao-v1");
    expect(XINGYAO_PRODUCT_ISSUER).toBe("xingyao-product");
    expect(HERMES_AUDIENCE).toBe("xingyao-hermes-agent");
  });

  it("accepts only exact actor profile fields", () => {
    const profile = {
      userId: UUID_A,
      organizationId: UUID_B,
      role: "owner",
      conversationId: UUID_C,
      allowedReadScopes: ["context.read"],
      skillGrantsHash: "grants-v1",
      profileVersion: "hermes-xingyao-v1",
    };

    expect(isHermesActorProfile(profile)).toBe(true);
    expect(
      isHermesActorProfile({ ...profile, organizationName: "客户端注入" }),
    ).toBe(false);
    expect(isHermesActorProfile({ ...profile, role: "admin" })).toBe(false);
  });
});

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
