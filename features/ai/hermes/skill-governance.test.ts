import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { computeHermesSkillGrantsHash } from "./actor-fingerprint";
import { computeHermesSkillBundleSha256 } from "./approved-skill-registry";
import {
  HERMES_BUILTIN_SKILL_CATALOG,
  evaluateHermesSkillGrantsForActor,
  toHermesSkillGrantAuditEvent,
} from "./skill-governance";
import { loadHermesSkillSigningKeyFromEnv, signHermesSkillApproval } from "./skill-signing";

describe("Hermes Skill governance", () => {
  it("pins the product Skill catalog to the official fork builtin manifest", () => {
    expect(
      HERMES_BUILTIN_SKILL_CATALOG.map((skill) => ({
        skillId: skill.skillId,
        version: skill.version,
        bundleSha256: skill.bundleSha256,
      })),
    ).toEqual([
      {
        skillId: "business-context",
        version: "1.0.0",
        bundleSha256:
          "731ebee4b861002857d52f16c22780f0a05959c03f03aa85d7b093053d045fea",
      },
      {
        skillId: "project-review",
        version: "1.0.0",
        bundleSha256:
          "ddeccbc63ea892a820279fd5adef23f151a750f68bee14cab8289b83f6744918",
      },
      {
        skillId: "report-precheck",
        version: "1.0.0",
        bundleSha256:
          "1863892faf70394e318c15dc0eb54a1ceab15d99579864a911c24578eae774fd",
      },
      {
        skillId: "settlement-analysis",
        version: "1.0.0",
        bundleSha256:
          "31091766970205b93c59043ff47960e9899fdf90693736c66af5480367cab300",
      },
    ]);
  });

  it("grants only Skills allowed by the actor role and read scopes", () => {
    const owner = evaluateHermesSkillGrantsForActor({
      role: "owner",
      allowedReadScopes: [
        "context.read",
        "projects.search",
        "projects.summary",
        "streamers.project_profile",
        "live_reports.search",
        "recording_reviews.search",
        "knowledge.search",
        "settlements.summary",
      ],
    });
    const finance = evaluateHermesSkillGrantsForActor({
      role: "finance",
      allowedReadScopes: [
        "context.read",
        "projects.search",
        "projects.summary",
        "knowledge.search",
        "settlements.summary",
      ],
    });
    const streamer = evaluateHermesSkillGrantsForActor({
      role: "streamer",
      allowedReadScopes: ["context.read"],
    });

    expect(owner.enabledSkillVersions.map((skill) => skill.skillId)).toEqual([
      "business-context",
      "project-review",
      "report-precheck",
      "settlement-analysis",
    ]);
    expect(finance.enabledSkillVersions.map((skill) => skill.skillId)).toEqual([
      "business-context",
      "settlement-analysis",
    ]);
    expect(streamer.enabledSkillVersions.map((skill) => skill.skillId)).toEqual([
      "business-context",
    ]);
    expect(
      finance.decisions.find((decision) => decision.skillId === "project-review"),
    ).toMatchObject({
      granted: false,
      reason: "role_not_allowed",
    });
    expect(
      streamer.decisions.find(
        (decision) => decision.skillId === "settlement-analysis",
      ),
    ).toMatchObject({
      granted: false,
      reason: "missing_read_scope",
      missingReadScopes: ["settlements.summary"],
    });
  });

  it("emits an immutable audit event for the signed Skill grants", () => {
    const evaluation = evaluateHermesSkillGrantsForActor({
      role: "finance",
      allowedReadScopes: [
        "context.read",
        "projects.search",
        "projects.summary",
        "knowledge.search",
        "settlements.summary",
      ],
    });

    const audit = toHermesSkillGrantAuditEvent({
      actor: {
        organizationId: "33333333-3333-4333-8333-333333333333",
        userId: "22222222-2222-4222-8222-222222222222",
        role: "finance",
        conversationId: "44444444-4444-4444-8444-444444444444",
        invocationId: "66666666-6666-4666-8666-666666666666",
        profileVersion: "hermes-xingyao-v1+skills.c1755ec71e802748",
      },
      evaluation,
    });

    expect(audit).toMatchObject({
      type: "hermes.skill_grants.evaluated",
      organizationId: "33333333-3333-4333-8333-333333333333",
      userId: "22222222-2222-4222-8222-222222222222",
      role: "finance",
      profileVersion: "hermes-xingyao-v1+skills.c1755ec71e802748",
      enabledSkillIds: ["business-context", "settlement-analysis"],
      skillGrantsHash: computeHermesSkillGrantsHash(
        evaluation.enabledSkillVersions,
      ),
    });
    expect(audit.decisions).toHaveLength(4);
  });

  it("adds only approved signed draft Skills that match actor grants", () => {
    const key = testSigningKey("skill-key-2026-07");
    const manifest = {
      skillId: "risk-review",
      version: "1.0.0",
      allowedRoles: ["owner"],
      requiredReadScopes: ["projects.summary"],
    };
    const bundle = "# Risk review";
    const bundleSha256 = computeHermesSkillBundleSha256(bundle);
    const signed = signHermesSkillApproval({
      manifest,
      bundleSha256,
      signingKey: key,
    });
    const approved = {
      id: "55555555-5555-4555-8555-555555555555",
      organization_id: "33333333-3333-4333-8333-333333333333",
      owner_user_id: "22222222-2222-4222-8222-222222222222",
      skill_id: "risk-review",
      version: 1,
      manifest,
      bundle,
      bundle_sha256: bundleSha256,
      status: "approved",
      signing_key_id: signed.signingKeyId,
      signature: signed.signature,
    };

    const evaluation = evaluateHermesSkillGrantsForActor({
      role: "owner",
      allowedReadScopes: ["context.read", "projects.summary"],
      actor: {
        organizationId: "33333333-3333-4333-8333-333333333333",
        userId: "22222222-2222-4222-8222-222222222222",
      },
      approvedDraftRows: [
        approved,
        { ...approved, id: "55555555-5555-4555-8555-555555555556", status: "rejected" },
        { ...approved, id: "55555555-5555-4555-8555-555555555557", signature: null },
        { ...approved, id: "55555555-5555-4555-8555-555555555558", bundle_sha256: "b".repeat(64) },
      ],
      publicKeys: { [key.keyId]: key.publicKeyPem },
    });

    expect(evaluation.enabledSkillVersions).toContainEqual({
      skillId: "risk-review",
      version: "1.0.0",
      bundleSha256,
    });
    expect(
      evaluation.decisions.find((decision) => decision.skillId === "risk-review"),
    ).toMatchObject({ granted: true, reason: "granted" });
    expect(evaluation.skillGrantsHash).toBe(
      computeHermesSkillGrantsHash(evaluation.enabledSkillVersions),
    );
  });
});

function testSigningKey(keyId: string) {
  const { privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const signingKey = loadHermesSkillSigningKeyFromEnv({
    XINGYAO_HERMES_SKILL_SIGNING_PRIVATE_KEY: privateKeyPem,
    XINGYAO_HERMES_SKILL_SIGNING_KEY_ID: keyId,
  });
  return signingKey;
}
