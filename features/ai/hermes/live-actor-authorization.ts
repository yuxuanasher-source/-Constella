import {
  computeHermesSkillGrantsHash,
  createHermesActorFingerprint,
} from "./actor-fingerprint";
import {
  isHermesActorProfile,
  isHermesAuthRole,
  type HermesActorProfile,
  type HermesAuthRole,
  type HermesSkillGrant,
} from "./contracts";
import { getAllowedReadScopesForRole } from "./read-scopes";
import { evaluateHermesSkillGrantsForActor } from "./skill-governance";

type MembershipQueryResult = {
  data: unknown;
  error: unknown;
};

type MembershipQuery = {
  select(columns: string): MembershipQuery;
  eq(column: string, value: unknown): MembershipQuery;
  maybeSingle(): PromiseLike<MembershipQueryResult>;
};

export type HermesLiveActorAuthorizationClient = {
  from(table: "organization_members"): MembershipQuery;
};

export type HermesLiveActorAuthorizationErrorCode =
  | "invalid_snapshot"
  | "membership_query_failed"
  | "membership_inactive"
  | "unknown_role"
  | "actor_changed";

const ERROR_MESSAGES: Record<HermesLiveActorAuthorizationErrorCode, string> = {
  invalid_snapshot: "Hermes actor snapshot is invalid",
  membership_query_failed: "Hermes membership could not be verified",
  membership_inactive: "Hermes membership is not active",
  unknown_role: "Hermes membership role is not authorized",
  actor_changed: "Hermes actor authorization changed",
};

export class HermesLiveActorAuthorizationError extends Error {
  constructor(public readonly code: HermesLiveActorAuthorizationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "HermesLiveActorAuthorizationError";
  }
}

export async function authorizeLiveHermesActor({
  client,
  actorSnapshot,
  expectedActorFingerprint,
  resolveSkillGrants,
}: {
  client: HermesLiveActorAuthorizationClient;
  actorSnapshot: HermesActorProfile;
  expectedActorFingerprint: string;
  resolveSkillGrants?: (input: {
    role: HermesAuthRole;
    allowedReadScopes: HermesActorProfile["allowedReadScopes"];
    actorSnapshot: HermesActorProfile;
  }) => Promise<readonly HermesSkillGrant[]>;
}): Promise<{ actor: HermesActorProfile; actorFingerprint: string }> {
  if (
    !isHermesActorProfile(actorSnapshot) ||
    actorSnapshot.skillGrantsHash !==
      computeHermesSkillGrantsHash(actorSnapshot.enabledSkillVersions) ||
    !isSha256(expectedActorFingerprint)
  ) {
    throw new HermesLiveActorAuthorizationError("invalid_snapshot");
  }

  const snapshotFingerprint = createHermesActorFingerprint(actorSnapshot);
  if (snapshotFingerprint !== expectedActorFingerprint) {
    throw new HermesLiveActorAuthorizationError("invalid_snapshot");
  }

  const { data, error } = await client
    .from("organization_members")
    .select("role")
    .eq("organization_id", actorSnapshot.organizationId)
    .eq("user_id", actorSnapshot.userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new HermesLiveActorAuthorizationError("membership_query_failed");
  }
  if (!isRecord(data)) {
    throw new HermesLiveActorAuthorizationError("membership_inactive");
  }
  if (!isHermesAuthRole(data.role)) {
    throw new HermesLiveActorAuthorizationError("unknown_role");
  }

  const role = data.role;
  const allowedReadScopes = getAllowedReadScopesForRole(role);
  const enabledSkillVersions = resolveSkillGrants
    ? [
        ...(await resolveSkillGrants({
          role,
          allowedReadScopes,
          actorSnapshot,
        })),
      ]
    : evaluateHermesSkillGrantsForActor({ role, allowedReadScopes })
        .enabledSkillVersions;
  const skillGrantsHash = computeHermesSkillGrantsHash(enabledSkillVersions);
  const actor: HermesActorProfile = {
    ...actorSnapshot,
    role,
    allowedReadScopes,
    enabledSkillVersions,
    skillGrantsHash,
  };

  if (!isHermesActorProfile(actor)) {
    throw new HermesLiveActorAuthorizationError("actor_changed");
  }

  const actorFingerprint = createHermesActorFingerprint(actor);
  if (
    role !== actorSnapshot.role ||
    !sameSet(allowedReadScopes, actorSnapshot.allowedReadScopes) ||
    skillGrantsHash !== actorSnapshot.skillGrantsHash ||
    actorFingerprint !== expectedActorFingerprint
  ) {
    throw new HermesLiveActorAuthorizationError("actor_changed");
  }

  return { actor, actorFingerprint };
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
