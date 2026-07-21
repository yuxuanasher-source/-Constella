import { describe, expect, it } from "vitest";

import {
  computeHermesScopesHash,
  computeHermesSkillGrantsHash,
  createHermesActorFingerprint,
} from "./actor-fingerprint";
import type { HermesActorProfile } from "./contracts";

describe("Hermes actor fingerprint", () => {
  it("matches the official fork fixture hashes", () => {
    expect(computeHermesSkillGrantsHash(BASE_PROFILE.enabledSkillVersions)).toBe(
      "458147f2ca44ee9d33b9c01dfdf8b678ff903b27b7c0a6aa8b92ced3c644c310",
    );
    expect(computeHermesScopesHash(BASE_PROFILE.allowedReadScopes)).toBe(
      "403df7d55bd3bc46d8ad6b7ee4b1bdcc49fe92e8871fc7ff0a54d66f48b7c435",
    );
    expect(createHermesActorFingerprint(BASE_PROFILE)).toBe(
      "e81c5a662616209a2e5e22da39bfc791bf822dd51314fab8918615e895bc41a4",
    );
  });

  it("is stable across read-scope ordering", () => {
    expect(
      createHermesActorFingerprint({
        ...BASE_PROFILE,
        allowedReadScopes: ["projects.search", "context.read"],
        skillGrantsHash: computeHermesSkillGrantsHash(
          BASE_PROFILE.enabledSkillVersions,
        ),
      }),
    ).toBe(
      createHermesActorFingerprint({
        ...BASE_PROFILE,
        allowedReadScopes: ["context.read", "projects.search"],
        skillGrantsHash: computeHermesSkillGrantsHash(
          BASE_PROFILE.enabledSkillVersions,
        ),
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
  invocationId: "44444444-4444-4444-8444-444444444444",
  allowedReadScopes: ["context.read", "projects.summary"],
  enabledSkillVersions: [
    {
      skillId: "project-review",
      version: "1.0.0",
      bundleSha256:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    {
      skillId: "report-precheck",
      version: "2.0.0",
      bundleSha256:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
  ],
  skillGrantsHash:
    "458147f2ca44ee9d33b9c01dfdf8b678ff903b27b7c0a6aa8b92ced3c644c310",
  profileVersion: "hermes-xingyao-v1+skills.c1755ec71e802748",
  pageContext: {
    pageType: "project",
    objectIds: ["66666666-6666-4666-8666-666666666666"],
  },
};
