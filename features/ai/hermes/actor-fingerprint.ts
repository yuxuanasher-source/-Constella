import { createHash } from "node:crypto";

import type { HermesActorProfile } from "./contracts";

export function createHermesActorFingerprint(
  profile: HermesActorProfile,
): string {
  return createHash("sha256")
    .update(canonicalJson(canonicalActorProfile(profile)))
    .digest("hex");
}

function canonicalActorProfile(profile: HermesActorProfile) {
  return {
    userId: profile.userId,
    organizationId: profile.organizationId,
    role: profile.role,
    conversationId: profile.conversationId,
    allowedReadScopes: [...profile.allowedReadScopes].sort(),
    skillGrantsHash: profile.skillGrantsHash,
    profileVersion: profile.profileVersion,
  };
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
