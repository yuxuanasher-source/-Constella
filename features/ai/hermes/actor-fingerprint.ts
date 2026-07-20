import { createHash } from "node:crypto";

import {
  canonicalUuidSchema,
  hermesRoleSchema,
  readScopeSchema,
  sha256Schema,
  skillGrantSchema,
  type HermesRole,
  type SkillGrant,
  type XingyaoReadScope,
} from "./contracts";

const PROFILE_VERSION_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,63})$/;

export class HermesActorFingerprintError extends TypeError {
  readonly code = "hermes_actor_fingerprint_input_invalid";

  constructor() {
    super("Hermes actor fingerprint input is invalid");
    this.name = "HermesActorFingerprintError";
  }
}

function compareCanonical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort(compareCanonical)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new HermesActorFingerprintError();
  }
  return serialized;
}

function sha256CanonicalJson(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

export function normalizeSkillGrants(
  grants: readonly SkillGrant[],
): readonly SkillGrant[] {
  if (!Array.isArray(grants) || grants.length > 50) {
    throw new HermesActorFingerprintError();
  }
  const parsed = grants.map((grant) => {
    const result = skillGrantSchema.safeParse(grant);
    if (!result.success) {
      throw new HermesActorFingerprintError();
    }
    return result.data;
  });
  if (new Set(parsed.map((grant) => grant.skillId)).size !== parsed.length) {
    throw new HermesActorFingerprintError();
  }
  return Object.freeze(
    parsed
      .sort(
        (left, right) =>
          compareCanonical(left.skillId, right.skillId) ||
          compareCanonical(left.version, right.version) ||
          compareCanonical(left.bundleSha256, right.bundleSha256),
      )
      .map((grant) => Object.freeze({ ...grant })),
  );
}

export function normalizeReadScopes(
  scopes: readonly XingyaoReadScope[],
): readonly XingyaoReadScope[] {
  if (!Array.isArray(scopes) || scopes.length === 0 || scopes.length > 8) {
    throw new HermesActorFingerprintError();
  }
  const parsed = scopes.map((scope) => {
    const result = readScopeSchema.safeParse(scope);
    if (!result.success) {
      throw new HermesActorFingerprintError();
    }
    return result.data;
  });
  if (new Set(parsed).size !== parsed.length) {
    throw new HermesActorFingerprintError();
  }
  return Object.freeze(parsed.sort(compareCanonical));
}

export function buildSkillGrantsHash(grants: readonly SkillGrant[]): string {
  return sha256CanonicalJson(normalizeSkillGrants(grants));
}

export function buildReadScopesHash(
  scopes: readonly XingyaoReadScope[],
): string {
  return sha256CanonicalJson(normalizeReadScopes(scopes));
}

export function buildActorFingerprint(input: {
  userId: string;
  organizationId: string;
  role: HermesRole;
  conversationId: string;
  allowedReadScopes: readonly XingyaoReadScope[];
  skillGrantsHash: string;
  profileVersion: string;
}): string {
  if (
    !canonicalUuidSchema.safeParse(input.userId).success ||
    !canonicalUuidSchema.safeParse(input.organizationId).success ||
    !canonicalUuidSchema.safeParse(input.conversationId).success ||
    !hermesRoleSchema.safeParse(input.role).success ||
    !sha256Schema.safeParse(input.skillGrantsHash).success ||
    !PROFILE_VERSION_PATTERN.test(input.profileVersion)
  ) {
    throw new HermesActorFingerprintError();
  }
  const scopesHash = buildReadScopesHash(input.allowedReadScopes);
  return sha256CanonicalJson({
    organizationId: input.organizationId,
    userId: input.userId,
    role: input.role,
    scopesHash,
    skillGrantsHash: input.skillGrantsHash,
    conversationId: input.conversationId,
    profileVersion: input.profileVersion,
  });
}
