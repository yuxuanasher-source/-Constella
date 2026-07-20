export const HERMES_KERNEL_ID = "hermes-agent-fork";
export const HERMES_BUILTIN_SKILLS_SHA256 =
  "c1755ec71e802748d518c2a27c81d429c95f8e31b1b82ab77d966e60469c9239";
export const HERMES_PROFILE_VERSION = `hermes-xingyao-v1+skills.${HERMES_BUILTIN_SKILLS_SHA256.slice(
  0,
  16,
)}`;
export const XINGYAO_PRODUCT_ISSUER = "xingyao-product";
export const HERMES_AUDIENCE = "xingyao-hermes-agent";

export const HERMES_AUTH_ROLES = [
  "owner",
  "ops_manager",
  "operator_business",
  "finance",
  "streamer",
] as const;

export type HermesAuthRole = (typeof HERMES_AUTH_ROLES)[number];

export type HermesReadScope =
  | "context.read"
  | "projects.search"
  | "projects.summary"
  | "streamers.project_profile"
  | "live_reports.search"
  | "recording_reviews.search"
  | "knowledge.search"
  | "settlements.summary";

export type HermesActorProfile = {
  userId: string;
  organizationId: string;
  role: HermesAuthRole;
  conversationId: string;
  invocationId: string;
  allowedReadScopes: HermesReadScope[];
  enabledSkillVersions: HermesSkillGrant[];
  skillGrantsHash: string;
  profileVersion: string;
  pageContext: HermesActorPageContext;
};

export type HermesSkillGrant = {
  skillId: string;
  version: string;
  bundleSha256: string;
};

export type HermesActorPageContext = {
  pageType: string;
  objectIds: string[];
};

const ACTOR_PROFILE_KEYS = [
  "allowedReadScopes",
  "conversationId",
  "enabledSkillVersions",
  "invocationId",
  "organizationId",
  "pageContext",
  "profileVersion",
  "role",
  "skillGrantsHash",
  "userId",
] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const READ_SCOPES: readonly HermesReadScope[] = [
  "context.read",
  "projects.search",
  "projects.summary",
  "streamers.project_profile",
  "live_reports.search",
  "recording_reviews.search",
  "knowledge.search",
  "settlements.summary",
];

const SKILL_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(-(0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)([.](0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?([+][0-9A-Za-z-]+([.][0-9A-Za-z-]+)*)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PAGE_TYPE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export function isHermesActorProfile(
  value: unknown,
): value is HermesActorProfile {
  if (!isRecord(value) || !hasExactKeys(value, ACTOR_PROFILE_KEYS)) {
    return false;
  }

  return (
    isUuid(value.userId) &&
    isUuid(value.organizationId) &&
    isHermesAuthRole(value.role) &&
    isUuid(value.conversationId) &&
    isUuid(value.invocationId) &&
    isReadScopeArray(value.allowedReadScopes) &&
    isHermesSkillGrantArray(value.enabledSkillVersions) &&
    isSha256(value.skillGrantsHash) &&
    value.profileVersion === HERMES_PROFILE_VERSION &&
    isHermesActorPageContext(value.pageContext)
  );
}

export function isHermesAuthRole(value: unknown): value is HermesAuthRole {
  return (
    typeof value === "string" &&
    HERMES_AUTH_ROLES.includes(value as HermesAuthRole)
  );
}

export function isHermesReadScope(value: unknown): value is HermesReadScope {
  return (
    typeof value === "string" && READ_SCOPES.includes(value as HermesReadScope)
  );
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

function isReadScopeArray(value: unknown): value is HermesReadScope[] {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  const seen = new Set<string>();
  for (const scope of value) {
    if (!isHermesReadScope(scope) || seen.has(scope)) {
      return false;
    }
    seen.add(scope);
  }
  return true;
}

export function isHermesSkillGrant(value: unknown): value is HermesSkillGrant {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["bundleSha256", "skillId", "version"]) &&
    typeof value.skillId === "string" &&
    SKILL_ID_PATTERN.test(value.skillId) &&
    typeof value.version === "string" &&
    value.version.length <= 64 &&
    SEMVER_PATTERN.test(value.version) &&
    isSha256(value.bundleSha256)
  );
}

function isHermesSkillGrantArray(value: unknown): value is HermesSkillGrant[] {
  if (!Array.isArray(value) || value.length > 50) {
    return false;
  }
  const seen = new Set<string>();
  for (const grant of value) {
    if (!isHermesSkillGrant(grant) || seen.has(grant.skillId)) {
      return false;
    }
    seen.add(grant.skillId);
  }
  return true;
}

function isHermesActorPageContext(
  value: unknown,
): value is HermesActorPageContext {
  if (!isRecord(value) || !hasExactKeys(value, ["objectIds", "pageType"])) {
    return false;
  }
  if (
    typeof value.pageType !== "string" ||
    !PAGE_TYPE_PATTERN.test(value.pageType)
  ) {
    return false;
  }
  if (!Array.isArray(value.objectIds) || value.objectIds.length > 20) {
    return false;
  }
  const seen = new Set<string>();
  for (const id of value.objectIds) {
    if (!isUuid(id) || seen.has(id)) {
      return false;
    }
    seen.add(id);
  }
  return true;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
