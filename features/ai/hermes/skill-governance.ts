import { computeHermesSkillGrantsHash } from "./actor-fingerprint";
import {
  HERMES_BUILTIN_SKILLS_SHA256,
  LEGACY_HERMES_PROFILE_VERSION,
  isHermesAuthRole,
  isHermesReadScope,
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
  reason: "granted" | "role_not_allowed" | "missing_read_scope";
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

const ALL_ROLES = [
  "owner",
  "ops_manager",
  "operator_business",
  "finance",
  "streamer",
] as const satisfies readonly HermesAuthRole[];

const OPERATIONS_ROLES = [
  "owner",
  "ops_manager",
  "operator_business",
  "streamer",
] as const satisfies readonly HermesAuthRole[];

export const HERMES_BUILTIN_SKILL_CATALOG = [
  {
    skillId: "business-context",
    version: "1.0.0",
    bundleSha256:
      "627cdc721b8bcfecdc74ae0b47c17c31181f31848f57aaae7cfe2b15b13b22bd",
    displayName: "Business Context",
    description: "Read-only business context summarization for the current actor.",
    requiredReadScopes: ["context.read"],
    allowedRoles: ALL_ROLES,
  },
  {
    skillId: "project-review",
    version: "1.0.0",
    bundleSha256:
      "d654fac184ece2b6f89dbd547995de88f6f534e8f2f2c126de1be8d745291155",
    displayName: "Project Review",
    description: "Read-only project, streamer, live report and review analysis.",
    requiredReadScopes: [
      "projects.summary",
      "streamers.project_profile",
      "live_reports.search",
      "recording_reviews.search",
      "knowledge.search",
    ],
    allowedRoles: OPERATIONS_ROLES,
  },
  {
    skillId: "report-precheck",
    version: "1.0.0",
    bundleSha256:
      "fc935ac608c49bdb8fd3d1bde34081df47e3aa1bb3ccec43e632c914be097d4d",
    displayName: "Report Precheck",
    description: "Read-only live report and recording review precheck.",
    requiredReadScopes: [
      "projects.summary",
      "live_reports.search",
      "recording_reviews.search",
    ],
    allowedRoles: OPERATIONS_ROLES,
  },
  {
    skillId: "settlement-analysis",
    version: "1.0.0",
    bundleSha256:
      "8a4432abfdbce16af4f73c7cb5a8a005390f50f8dad833353af8f5f55b791506",
    displayName: "Settlement Analysis",
    description: "Read-only settlement summary analysis.",
    requiredReadScopes: ["settlements.summary"],
    allowedRoles: ALL_ROLES,
  },
] as const satisfies readonly HermesBuiltinSkillCatalogEntry[];

export function evaluateHermesSkillGrantsForActor({
  role,
  allowedReadScopes,
}: {
  role: unknown;
  allowedReadScopes: readonly unknown[];
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
  actor: {
    organizationId: string;
    userId: string;
    role: string;
    conversationId: string;
    invocationId: string;
  };
  evaluation: HermesSkillGrantEvaluation;
}): HermesSkillGrantAuditEvent {
  return {
    type: "hermes.skill_grants.evaluated",
    organizationId: actor.organizationId,
    userId: actor.userId,
    role: actor.role,
    conversationId: actor.conversationId,
    invocationId: actor.invocationId,
    profileVersion: LEGACY_HERMES_PROFILE_VERSION,
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
