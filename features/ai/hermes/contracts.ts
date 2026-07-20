import { z } from "zod";

export const HERMES_PROFILE_VERSION = "hermes-xingyao-v1";
export const ACTOR_ASSERTION_ISSUER = "xingyao-product";
export const ACTOR_ASSERTION_AUDIENCE = "xingyao-hermes-agent";

export const HERMES_ROLES = Object.freeze([
  "owner",
  "ops_manager",
  "operator_business",
  "finance",
  "streamer",
] as const);

export const XINGYAO_READ_SCOPES = Object.freeze([
  "context.read",
  "projects.search",
  "projects.summary",
  "streamers.project_profile",
  "live_reports.search",
  "recording_reviews.search",
  "knowledge.search",
  "settlements.summary",
] as const);

export const READ_API_STATUSES = Object.freeze(["ok", "partial"] as const);

export const READ_API_ERROR_CODES = Object.freeze([
  "unauthorized",
  "permission_denied",
  "not_found",
  "invalid_request",
  "rate_limited",
  "upstream_unavailable",
  "internal_error",
] as const);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SKILL_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(-(0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)([.](0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?([+][0-9A-Za-z-]+([.][0-9A-Za-z-]+)*)?$/;
const PAGE_TYPE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

function compareCanonical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export const hermesRoleSchema = z.enum(HERMES_ROLES);
export const readScopeSchema = z.enum(XINGYAO_READ_SCOPES);
export const readApiStatusSchema = z.enum(READ_API_STATUSES);
export const readApiErrorCodeSchema = z.enum(READ_API_ERROR_CODES);
export const canonicalUuidSchema = z.string().regex(UUID_PATTERN);
export const sha256Schema = z.string().regex(SHA256_PATTERN);

export const skillGrantSchema = z.strictObject({
  skillId: z.string().min(1).max(64).regex(SKILL_ID_PATTERN),
  version: z.string().max(64).regex(SEMVER_PATTERN),
  bundleSha256: sha256Schema,
});

const allowedReadScopesSchema = z
  .array(readScopeSchema)
  .min(1)
  .max(XINGYAO_READ_SCOPES.length)
  .superRefine((scopes, context) => {
    if (new Set(scopes).size !== scopes.length) {
      context.addIssue({
        code: "custom",
        message: "allowedReadScopes must not contain duplicates",
      });
    }
  })
  .transform((scopes) => [...scopes].sort());

const skillGrantsSchema = z
  .array(skillGrantSchema)
  .max(50)
  .superRefine((grants, context) => {
    const skillIds = grants.map((grant) => grant.skillId);
    if (new Set(skillIds).size !== skillIds.length) {
      context.addIssue({
        code: "custom",
        message:
          "enabledSkillVersions must not contain duplicate skillId values",
      });
    }
  })
  .transform((grants) =>
    [...grants].sort(
      (left, right) =>
        compareCanonical(left.skillId, right.skillId) ||
        compareCanonical(left.version, right.version) ||
        compareCanonical(left.bundleSha256, right.bundleSha256),
    ),
  );

export const pageContextSchema = z
  .strictObject({
    pageType: z.string().min(1).max(64).regex(PAGE_TYPE_PATTERN),
    objectIds: z
      .array(canonicalUuidSchema)
      .max(20)
      .superRefine((objectIds, context) => {
        if (new Set(objectIds).size !== objectIds.length) {
          context.addIssue({
            code: "custom",
            message: "pageContext.objectIds must not contain duplicates",
          });
        }
      }),
  })
  .transform((pageContext) => ({
    ...pageContext,
    objectIds: [...pageContext.objectIds].sort(),
  }));

export const actorAssertionClaimsSchema = z.strictObject({
  iss: z.literal(ACTOR_ASSERTION_ISSUER),
  aud: z.literal(ACTOR_ASSERTION_AUDIENCE),
  sub: canonicalUuidSchema,
  organizationId: canonicalUuidSchema,
  role: hermesRoleSchema,
  conversationId: canonicalUuidSchema,
  invocationId: canonicalUuidSchema,
  allowedReadScopes: allowedReadScopesSchema,
  enabledSkillVersions: skillGrantsSchema,
  skillGrantsHash: sha256Schema,
  profileVersion: z.literal(HERMES_PROFILE_VERSION),
  pageContext: pageContextSchema,
  jti: canonicalUuidSchema,
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
});

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function isJsonValue(
  value: unknown,
  seen: Set<object> = new Set(),
  depth = 0,
): value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (!value || typeof value !== "object" || depth > 32 || seen.has(value)) {
    return false;
  }
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen, depth + 1))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value).every((entry) =>
        isJsonValue(entry, seen, depth + 1),
      );
  seen.delete(value);
  return valid;
}

export const jsonValueSchema = z.custom<JsonValue>(isJsonValue, {
  message: "data must be a finite JSON value",
});

const metadataListSchema = z.array(z.string().trim().min(1).max(160)).max(100);

export const readApiEnvelopeSchema = z.strictObject({
  status: readApiStatusSchema,
  data: jsonValueSchema,
  evidenceRefs: metadataListSchema,
  sourceLabels: metadataListSchema,
  updatedAt: z.string().datetime({ offset: true }),
  missingData: metadataListSchema,
  permissionDenials: metadataListSchema,
  truncated: z.boolean(),
  toolInvocationId: canonicalUuidSchema,
  traceId: canonicalUuidSchema,
});

export const readApiErrorSchema = z.strictObject({
  status: z.literal("error"),
  error: z.strictObject({ code: readApiErrorCodeSchema }),
  toolInvocationId: canonicalUuidSchema,
  traceId: canonicalUuidSchema,
});

export const actorAssertionFixtureSchema = z.strictObject({
  version: z.literal("actor-assertion-v1"),
  protectedHeader: z.strictObject({
    alg: z.literal("RS256"),
    typ: z.literal("JWT"),
    kid: z.string().trim().min(1).max(128),
  }),
  claims: actorAssertionClaimsSchema,
  expected: z.strictObject({
    skillGrantsHash: sha256Schema,
    scopesHash: sha256Schema,
    actorFingerprint: sha256Schema,
  }),
  publicKeyPem: z
    .string()
    .startsWith("-----BEGIN PUBLIC KEY-----\n")
    .endsWith("-----END PUBLIC KEY-----\n"),
  token: z.string().regex(/^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$/),
});

export const readApiFixtureSchema = z.strictObject({
  version: z.literal("read-api-v1"),
  envelope: readApiEnvelopeSchema,
  error: readApiErrorSchema,
});

export type HermesRole = z.infer<typeof hermesRoleSchema>;
export type XingyaoReadScope = z.infer<typeof readScopeSchema>;
export type SkillGrant = z.infer<typeof skillGrantSchema>;
export type PageContext = z.infer<typeof pageContextSchema>;
export type ActorAssertionClaims = z.infer<typeof actorAssertionClaimsSchema>;
export type ReadApiEnvelope = z.infer<typeof readApiEnvelopeSchema>;
export type ReadApiError = z.infer<typeof readApiErrorSchema>;
