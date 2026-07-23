import { computeHermesSkillGrantsHash } from "./actor-fingerprint";
import {
  HERMES_BUILTIN_APPROVED_SKILLS,
  resolveApprovedHermesSkillGrantsForActor,
  type HermesSkillDraftApprovalRow,
} from "./approved-skill-registry";
import {
  HERMES_BUILTIN_SKILLS_SHA256,
  isHermesAuthRole,
  isHermesReadScope,
  type HermesActorProfile,
  type HermesAuthRole,
  type HermesReadScope,
  type HermesSkillGrant,
} from "./contracts";

export type HermesBuiltinSkillCatalogEntry = HermesSkillGrant & {
  displayName: string;
  description: string;
  requiredReadScopes: readonly HermesReadScope[];
  allowedRoles: readonly HermesAuthRole[];
};

export type HermesSkillGrantDecision = {
  skillId: string;
  version: string;
  granted: boolean;
  reason:
    | "granted"
    | "role_not_allowed"
    | "missing_read_scope"
    | "not_approved";
  missingReadScopes?: HermesReadScope[];
};

export type HermesSkillGrantEvaluation = {
  enabledSkillVersions: HermesSkillGrant[];
  decisions: HermesSkillGrantDecision[];
  skillGrantsHash: string;
};

export type HermesSkillGrantAuditEvent = {
  type: "hermes.skill_grants.evaluated";
  organizationId: string;
  userId: string;
  role: string;
  conversationId: string;
  invocationId: string;
  profileVersion: string;
  builtinSkillsSha256: string;
  enabledSkillIds: string[];
  skillGrantsHash: string;
  decisions: HermesSkillGrantDecision[];
};

export const HERMES_BUILTIN_SKILL_CATALOG =
  HERMES_BUILTIN_APPROVED_SKILLS satisfies readonly HermesBuiltinSkillCatalogEntry[];

export function evaluateHermesSkillGrantsForActor({
  role,
  allowedReadScopes,
  actor,
  approvedDraftRows = [],
  publicKeys = {},
}: {
  role: unknown;
  allowedReadScopes: readonly unknown[];
  actor?: { organizationId: string; userId: string };
  approvedDraftRows?: readonly HermesSkillDraftApprovalRow[];
  publicKeys?: Record<string, string>;
}): HermesSkillGrantEvaluation {
  const actorRole = isHermesAuthRole(role) ? role : null;
  const readScopes = new Set(
    allowedReadScopes.filter(isHermesReadScope),
  );
  const enabledSkillVersions: HermesSkillGrant[] = [];
  const decisions: HermesSkillGrantDecision[] = [];

  for (const skill of HERMES_BUILTIN_SKILL_CATALOG) {
    if (!actorRole || !roleAllows(skill.allowedRoles, actorRole)) {
      decisions.push({
        skillId: skill.skillId,
        version: skill.version,
        granted: false,
        reason: "role_not_allowed",
      });
      continue;
    }

    const missingReadScopes = skill.requiredReadScopes.filter(
      (scope) => !readScopes.has(scope),
    );
    if (missingReadScopes.length) {
      decisions.push({
        skillId: skill.skillId,
        version: skill.version,
        granted: false,
        reason: "missing_read_scope",
        missingReadScopes,
      });
      continue;
    }

    enabledSkillVersions.push(toSkillGrant(skill));
    decisions.push({
      skillId: skill.skillId,
      version: skill.version,
      granted: true,
      reason: "granted",
    });
  }

  if (actorRole && actor && approvedDraftRows.length) {
    const draftGrants = resolveApprovedHermesSkillGrantsForActor({
      actor: {
        organizationId: actor.organizationId,
        userId: actor.userId,
        role: actorRole,
        allowedReadScopes: [...readScopes],
      },
      rows: approvedDraftRows,
      publicKeys,
    });
    for (const grant of draftGrants) {
      if (
        enabledSkillVersions.some(
          (existing) => existing.skillId === grant.skillId,
        )
      ) {
        decisions.push({
          skillId: grant.skillId,
          version: grant.version,
          granted: false,
          reason: "not_approved",
        });
        continue;
      }
      enabledSkillVersions.push({
        skillId: grant.skillId,
        version: grant.version,
        bundleSha256: grant.bundleSha256,
      });
      decisions.push({
        skillId: grant.skillId,
        version: grant.version,
        granted: true,
        reason: "granted",
      });
    }
  }

  return {
    enabledSkillVersions,
    decisions,
    skillGrantsHash: computeHermesSkillGrantsHash(enabledSkillVersions),
  };
}

export function toHermesSkillGrantAuditEvent({
  actor,
  evaluation,
}: {
  actor: Pick<
    HermesActorProfile,
    | "organizationId"
    | "userId"
    | "role"
    | "conversationId"
    | "invocationId"
    | "profileVersion"
  >;
  evaluation: HermesSkillGrantEvaluation;
}): HermesSkillGrantAuditEvent {
  return {
    type: "hermes.skill_grants.evaluated",
    organizationId: actor.organizationId,
    userId: actor.userId,
    role: actor.role,
    conversationId: actor.conversationId,
    invocationId: actor.invocationId,
    profileVersion: actor.profileVersion,
    builtinSkillsSha256: HERMES_BUILTIN_SKILLS_SHA256,
    enabledSkillIds: evaluation.enabledSkillVersions.map(
      (skill) => skill.skillId,
    ),
    skillGrantsHash: evaluation.skillGrantsHash,
    decisions: evaluation.decisions.map((decision) => ({ ...decision })),
  };
}

function toSkillGrant(skill: HermesBuiltinSkillCatalogEntry): HermesSkillGrant {
  return {
    skillId: skill.skillId,
    version: skill.version,
    bundleSha256: skill.bundleSha256,
  };
}

function roleAllows(
  allowedRoles: readonly HermesAuthRole[],
  role: HermesAuthRole,
): boolean {
  return allowedRoles.includes(role);
}
