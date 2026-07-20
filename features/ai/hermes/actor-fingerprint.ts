import { createHash } from "node:crypto";

import type { HermesActorProfile, HermesSkillGrant } from "./contracts";

export function createHermesActorFingerprint(
  profile: HermesActorProfile,
): string {
  return sha256Json({
    organizationId: profile.organizationId,
    userId: profile.userId,
    role: profile.role,
    scopesHash: computeHermesScopesHash(profile.allowedReadScopes),
    skillGrantsHash: profile.skillGrantsHash,
    conversationId: profile.conversationId,
    profileVersion: profile.profileVersion,
  });
}

export function computeHermesSkillGrantsHash(
  grants: readonly HermesSkillGrant[],
): string {
  return sha256Json(
    [...grants]
      .sort((left, right) =>
        [
          compareAscii(left.skillId, right.skillId),
          compareAscii(left.version, right.version),
          compareAscii(left.bundleSha256, right.bundleSha256),
        ].find((value) => value !== 0) ?? 0,
      )
      .map((grant) => ({
        skillId: grant.skillId,
        version: grant.version,
        bundleSha256: grant.bundleSha256,
      })),
  );
}

export function computeHermesScopesHash(scopes: readonly string[]): string {
  return sha256Json([...scopes].sort());
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => {
      const record = value as Record<string, unknown>;
      return `${JSON.stringify(key)}:${canonicalJson(record[key])}`;
    })
    .join(",")}}`;
}

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
