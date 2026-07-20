import { describe, expect, it } from "vitest";

import { createHermesActorFingerprint } from "./actor-fingerprint";
import type { HermesActorProfile } from "./contracts";

describe("Hermes actor fingerprint", () => {
  it("is stable across read-scope ordering", () => {
    expect(
      createHermesActorFingerprint({
        ...BASE_PROFILE,
        allowedReadScopes: ["projects.search", "context.read"],
      }),
    ).toBe(
      createHermesActorFingerprint({
        ...BASE_PROFILE,
        allowedReadScopes: ["context.read", "projects.search"],
      }),
    );
  });

  it("changes when role, scopes, grants, or profile version change", () => {
    const baseline = createHermesActorFingerprint(BASE_PROFILE);

    expect(
      createHermesActorFingerprint({ ...BASE_PROFILE, role: "finance" }),
    ).not.toBe(baseline);
    expect(
      createHermesActorFingerprint({
        ...BASE_PROFILE,
        allowedReadScopes: ["context.read"],
      }),
    ).not.toBe(baseline);
    expect(
      createHermesActorFingerprint({
        ...BASE_PROFILE,
        skillGrantsHash: "grants-v2",
      }),
    ).not.toBe(baseline);
    expect(
      createHermesActorFingerprint({
        ...BASE_PROFILE,
        profileVersion: "hermes-xingyao-v2",
      }),
    ).not.toBe(baseline);
  });
});

const BASE_PROFILE: HermesActorProfile = {
  userId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  role: "owner",
  conversationId: "33333333-3333-4333-8333-333333333333",
  allowedReadScopes: ["context.read", "projects.search"],
  skillGrantsHash: "grants-v1",
  profileVersion: "hermes-xingyao-v1",
};
