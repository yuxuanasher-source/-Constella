import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTOR_ASSERTION_AUDIENCE,
  ACTOR_ASSERTION_ISSUER,
  HERMES_PROFILE_VERSION,
  HERMES_ROLES,
  READ_API_ERROR_CODES,
  XINGYAO_READ_SCOPES,
  actorAssertionClaimsSchema,
  actorAssertionFixtureSchema,
  pageContextSchema,
  readApiEnvelopeSchema,
  readApiErrorSchema,
  readApiFixtureSchema,
  skillGrantSchema,
} from "./contracts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const INVOCATION_ID = "44444444-4444-4444-8444-444444444444";
const JTI = "55555555-5555-4555-8555-555555555555";
const OBJECT_ID = "66666666-6666-4666-8666-666666666666";

const SKILL_GRANTS_HASH =
  "458147f2ca44ee9d33b9c01dfdf8b678ff903b27b7c0a6aa8b92ced3c644c310";

function claims() {
  return {
    iss: ACTOR_ASSERTION_ISSUER,
    aud: ACTOR_ASSERTION_AUDIENCE,
    sub: USER_ID,
    organizationId: ORGANIZATION_ID,
    role: "owner",
    conversationId: CONVERSATION_ID,
    invocationId: INVOCATION_ID,
    allowedReadScopes: ["projects.summary", "context.read"],
    enabledSkillVersions: [
      {
        skillId: "report-precheck",
        version: "2.0.0",
        bundleSha256: "b".repeat(64),
      },
      {
        skillId: "project-review",
        version: "1.0.0",
        bundleSha256: "a".repeat(64),
      },
    ],
    skillGrantsHash: SKILL_GRANTS_HASH,
    profileVersion: HERMES_PROFILE_VERSION,
    pageContext: {
      pageType: "project",
      objectIds: [OBJECT_ID],
    },
    jti: JTI,
    iat: 1_784_505_600,
    exp: 1_784_505_900,
  };
}

function readFixture(name: "actor-assertion-v1.json" | "read-api-v1.json") {
  const path = resolve(
    process.cwd(),
    "features",
    "ai",
    "hermes",
    "fixtures",
    name,
  );
  const raw = readFileSync(path, "utf8");
  return { raw, value: JSON.parse(raw) as unknown };
}

describe("Hermes cross-repository contracts", () => {
  it("freezes the profile, actor endpoints, five roles, and eight read scopes", () => {
    expect(HERMES_PROFILE_VERSION).toBe("hermes-xingyao-v1");
    expect(ACTOR_ASSERTION_ISSUER).toBe("xingyao-product");
    expect(ACTOR_ASSERTION_AUDIENCE).toBe("xingyao-hermes-agent");
    expect(HERMES_ROLES).toEqual([
      "owner",
      "ops_manager",
      "operator_business",
      "finance",
      "streamer",
    ]);
    expect(XINGYAO_READ_SCOPES).toEqual([
      "context.read",
      "projects.search",
      "projects.summary",
      "streamers.project_profile",
      "live_reports.search",
      "recording_reviews.search",
      "knowledge.search",
      "settlements.summary",
    ]);
  });

  it("strictly parses and canonically sorts actor claims", () => {
    const parsed = actorAssertionClaimsSchema.parse(claims());

    expect(parsed.allowedReadScopes).toEqual([
      "context.read",
      "projects.summary",
    ]);
    expect(parsed.enabledSkillVersions.map((grant) => grant.skillId)).toEqual([
      "project-review",
      "report-precheck",
    ]);
    expect(parsed.pageContext.objectIds).toEqual([OBJECT_ID]);

    expect(
      actorAssertionClaimsSchema.safeParse({ ...claims(), unexpected: true })
        .success,
    ).toBe(false);
    expect(
      skillGrantSchema.safeParse({
        ...claims().enabledSkillVersions[0],
        organizationId: ORGANIZATION_ID,
      }).success,
    ).toBe(false);
    expect(
      pageContextSchema.safeParse({
        ...claims().pageContext,
        userId: USER_ID,
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate and malformed actor context values", () => {
    expect(
      actorAssertionClaimsSchema.safeParse({
        ...claims(),
        allowedReadScopes: ["context.read", "context.read"],
      }).success,
    ).toBe(false);
    expect(
      actorAssertionClaimsSchema.safeParse({
        ...claims(),
        enabledSkillVersions: [
          claims().enabledSkillVersions[0],
          claims().enabledSkillVersions[0],
        ],
      }).success,
    ).toBe(false);
    expect(
      actorAssertionClaimsSchema.safeParse({
        ...claims(),
        pageContext: {
          pageType: "project",
          objectIds: [OBJECT_ID, OBJECT_ID],
        },
      }).success,
    ).toBe(false);
    expect(
      actorAssertionClaimsSchema.safeParse({
        ...claims(),
        enabledSkillVersions: [
          {
            ...claims().enabledSkillVersions[0],
            version: "1.0.0-01",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires the complete strict Read API envelope", () => {
    const envelope = {
      status: "ok",
      data: { operation: "projects.summary" },
      evidenceRefs: ["project:77777777-7777-4777-8777-777777777777"],
      sourceLabels: ["project_record"],
      updatedAt: "2026-07-20T00:00:00.000Z",
      missingData: [],
      permissionDenials: [],
      truncated: false,
      toolInvocationId: INVOCATION_ID,
      traceId: "77777777-7777-4777-8777-777777777777",
    };

    expect(readApiEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(
      readApiEnvelopeSchema.safeParse({ ...envelope, traceId: undefined })
        .success,
    ).toBe(false);
    expect(
      readApiEnvelopeSchema.safeParse({
        ...envelope,
        organizationId: ORGANIZATION_ID,
      }).success,
    ).toBe(false);
  });

  it("allows only the frozen Read API error codes", () => {
    expect(READ_API_ERROR_CODES).toEqual([
      "unauthorized",
      "permission_denied",
      "not_found",
      "invalid_request",
      "rate_limited",
      "upstream_unavailable",
      "internal_error",
    ]);

    for (const code of READ_API_ERROR_CODES) {
      expect(
        readApiErrorSchema.safeParse({
          status: "error",
          error: { code },
          toolInvocationId: INVOCATION_ID,
          traceId: "77777777-7777-4777-8777-777777777777",
        }).success,
      ).toBe(true);
    }
    expect(
      readApiErrorSchema.safeParse({
        status: "error",
        error: { code: "database_error" },
        toolInvocationId: INVOCATION_ID,
        traceId: "77777777-7777-4777-8777-777777777777",
      }).success,
    ).toBe(false);
  });

  it("parses the canonical LF fixtures without private key material", () => {
    const actorFixture = readFixture("actor-assertion-v1.json");
    const readApiFixture = readFixture("read-api-v1.json");

    expect(actorFixture.raw).not.toContain("\r\n");
    expect(readApiFixture.raw).not.toContain("\r\n");
    expect(actorFixture.raw.endsWith("\n")).toBe(true);
    expect(readApiFixture.raw.endsWith("\n")).toBe(true);
    expect(actorFixture.raw).not.toContain("PRIVATE KEY");
    expect(
      actorAssertionFixtureSchema.safeParse(actorFixture.value).success,
    ).toBe(true);
    expect(readApiFixtureSchema.safeParse(readApiFixture.value).success).toBe(
      true,
    );
  });
});
