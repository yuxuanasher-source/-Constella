export const HERMES_KERNEL_ID = "hermes-agent-fork";
export const HERMES_PROFILE_VERSION = "hermes-xingyao-v1";
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
  allowedReadScopes: HermesReadScope[];
  skillGrantsHash: string;
  profileVersion: string;
};

const ACTOR_PROFILE_KEYS = [
  "allowedReadScopes",
  "conversationId",
  "organizationId",
  "profileVersion",
  "role",
  "skillGrantsHash",
  "userId",
] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    isReadScopeArray(value.allowedReadScopes) &&
    nonEmptyString(value.skillGrantsHash) &&
    value.profileVersion === HERMES_PROFILE_VERSION
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

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
