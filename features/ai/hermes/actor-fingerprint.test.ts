import { describe, expect, it } from "vitest";

import {
  buildActorFingerprint,
  buildReadScopesHash,
  buildSkillGrantsHash,
} from "./actor-fingerprint";

const grants = [
  {
    skillId: "project-review",
    version: "1.0.0",
    bundleSha256: "a".repeat(64),
  },
  {
    skillId: "report-precheck",
    version: "2.0.0",
    bundleSha256: "b".repeat(64),
  },
] as const;

const fingerprintInput = {
  userId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  role: "owner" as const,
  conversationId: "33333333-3333-4333-8333-333333333333",
  allowedReadScopes: ["projects.summary", "context.read"] as const,
  skillGrantsHash:
    "458147f2ca44ee9d33b9c01dfdf8b678ff903b27b7c0a6aa8b92ced3c644c310",
  profileVersion: "hermes-xingyao-v1",
};

describe("Hermes actor fingerprint", () => {
  it("matches all three frozen Python cross-repository vectors", () => {
    expect(buildSkillGrantsHash(grants)).toBe(
      "458147f2ca44ee9d33b9c01dfdf8b678ff903b27b7c0a6aa8b92ced3c644c310",
    );
    expect(buildReadScopesHash(fingerprintInput.allowedReadScopes)).toBe(
      "403df7d55bd3bc46d8ad6b7ee4b1bdcc49fe92e8871fc7ff0a54d66f48b7c435",
    );
    expect(buildActorFingerprint(fingerprintInput)).toBe(
      "a12e34f34379aed20cd1b6b4a17048cfda73851c89a60adea51e7af278eeac0f",
    );
  });

  it("is stable across scope and Skill grant input ordering", () => {
    expect(buildSkillGrantsHash([...grants].reverse())).toBe(
      buildSkillGrantsHash(grants),
    );
    expect(
      buildActorFingerprint({
        ...fingerprintInput,
        allowedReadScopes: [...fingerprintInput.allowedReadScopes].reverse(),
      }),
    ).toBe(buildActorFingerprint(fingerprintInput));
  });

  it("rotates when organization, role, scope, grant, or profile changes", () => {
    const baseline = buildActorFingerprint(fingerprintInput);
    const changed = [
      buildActorFingerprint({
        ...fingerprintInput,
        organizationId: "99999999-9999-4999-8999-999999999999",
      }),
      buildActorFingerprint({ ...fingerprintInput, role: "finance" }),
      buildActorFingerprint({
        ...fingerprintInput,
        allowedReadScopes: ["context.read", "projects.search"],
      }),
      buildActorFingerprint({
        ...fingerprintInput,
        skillGrantsHash: "c".repeat(64),
      }),
      buildActorFingerprint({
        ...fingerprintInput,
        profileVersion: "hermes-xingyao-v2",
      }),
    ];

    expect(changed.every((fingerprint) => fingerprint !== baseline)).toBe(true);
    expect(new Set(changed).size).toBe(changed.length);
  });

  it("rejects duplicate or malformed inputs before hashing", () => {
    expect(() => buildSkillGrantsHash([grants[0], grants[0]])).toThrow();
    expect(() =>
      buildReadScopesHash(["context.read", "context.read"]),
    ).toThrow();
    expect(() =>
      buildActorFingerprint({
        ...fingerprintInput,
        organizationId: "not-an-organization-id",
      }),
    ).toThrow();
  });
});
