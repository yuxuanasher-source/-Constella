import { describe, expect, it } from "vitest";

import { computeHermesSkillGrantsHash } from "./actor-fingerprint";
import {
  HERMES_BUILTIN_SKILL_CATALOG,
  evaluateHermesSkillGrantsForActor,
  toHermesSkillGrantAuditEvent,
} from "./skill-governance";

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
          "627cdc721b8bcfecdc74ae0b47c17c31181f31848f57aaae7cfe2b15b13b22bd",
      },
      {
        skillId: "project-review",
        version: "1.0.0",
        bundleSha256:
          "d654fac184ece2b6f89dbd547995de88f6f534e8f2f2c126de1be8d745291155",
      },
      {
        skillId: "report-precheck",
        version: "1.0.0",
        bundleSha256:
          "fc935ac608c49bdb8fd3d1bde34081df47e3aa1bb3ccec43e632c914be097d4d",
      },
      {
        skillId: "settlement-analysis",
        version: "1.0.0",
        bundleSha256:
          "8a4432abfdbce16af4f73c7cb5a8a005390f50f8dad833353af8f5f55b791506",
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
});
