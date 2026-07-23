import { NextResponse } from "next/server";

import {
  LEGACY_HERMES_KERNEL_ID,
  LEGACY_HERMES_PROFILE_VERSION,
} from "@/features/ai/hermes/contracts";
import {
  getHermesBuiltinSkillArtifacts,
  loadHermesSkillDraftApprovalRowsForActor,
  type HermesSkillDraftRegistryClient,
} from "@/features/ai/hermes/approved-skill-registry";
import { getAllowedReadScopesForRole } from "@/features/ai/hermes/read-scopes";
import {
  HERMES_BUILTIN_SKILL_CATALOG,
  evaluateHermesSkillGrantsForActor,
} from "@/features/ai/hermes/skill-governance";
import {
  getHermesSkillSigningPublicKeysFromEnv,
  hermesSkillSigningPublicKeysToRecord,
} from "@/features/ai/hermes/skill-signing";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const auth = supabase ? await getAuthContext(supabase) : null;
  if (!supabase || !auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isMcnStaff(auth.role)) {
    return NextResponse.json(
      { error: "Only MCN staff can inspect Xingyao AI Skills" },
      { status: 403 },
    );
  }

  const allowedReadScopes = getAllowedReadScopesForRole(auth.role);
  const signingPublicKeys = getHermesSkillSigningPublicKeysFromEnv();
  const publicKeys = hermesSkillSigningPublicKeysToRecord(signingPublicKeys);
  const approvedDraftRows = await loadHermesSkillDraftApprovalRowsForActor({
    client: supabase as unknown as HermesSkillDraftRegistryClient,
    actor: { organizationId: auth.organizationId, userId: auth.userId },
  });
  const evaluation = evaluateHermesSkillGrantsForActor({
    role: auth.role,
    allowedReadScopes,
    actor: { organizationId: auth.organizationId, userId: auth.userId },
    approvedDraftRows,
    publicKeys,
  });
  const decisionsBySkillId = new Map(
    evaluation.decisions.map((decision) => [decision.skillId, decision]),
  );
  const artifactsBySkillId = new Map(
    getHermesBuiltinSkillArtifacts().map((artifact) => [
      artifact.skillId,
      artifact,
    ]),
  );

  return NextResponse.json(
    {
      assistant: "xingyao-ai",
      kernelId: LEGACY_HERMES_KERNEL_ID,
      profileVersion: LEGACY_HERMES_PROFILE_VERSION,
      organizationId: auth.organizationId,
      userId: auth.userId,
      role: auth.role,
      allowedReadScopes,
      enabledSkillIds: evaluation.enabledSkillVersions.map(
        (skill) => skill.skillId,
      ),
      enabledSkillVersions: evaluation.enabledSkillVersions,
      skillGrantsHash: evaluation.skillGrantsHash,
      signingPublicKeys,
      skills: [
        ...HERMES_BUILTIN_SKILL_CATALOG.map((skill) => {
          const decision = decisionsBySkillId.get(skill.skillId);
          const artifact = artifactsBySkillId.get(skill.skillId);
          return {
            skillId: skill.skillId,
            version: skill.version,
            bundleSha256: skill.bundleSha256,
            displayName: skill.displayName,
            description: skill.description,
            requiredReadScopes: skill.requiredReadScopes,
            allowedRoles: skill.allowedRoles,
            enabled: Boolean(decision?.granted),
            reason: decision?.reason ?? "missing_read_scope",
            missingReadScopes: decision?.missingReadScopes ?? [],
            artifact: artifact
              ? {
                  path: skill.artifactPath,
                  sha256: artifact.bundleSha256,
                  sizeBytes: artifact.sizeBytes,
                }
              : null,
          };
        }),
        ...evaluation.enabledSkillVersions
          .filter(
            (grant) =>
              !HERMES_BUILTIN_SKILL_CATALOG.some(
                (skill) => skill.skillId === grant.skillId,
              ),
          )
          .map((grant) => ({
            skillId: grant.skillId,
            version: grant.version,
            bundleSha256: grant.bundleSha256,
            displayName: grant.skillId,
            description: "Approved Hermes Skill draft",
            requiredReadScopes: [],
            allowedRoles: [auth.role],
            enabled: true,
            reason: "granted",
            missingReadScopes: [],
            artifact: {
              source: "approved-draft",
              sha256: grant.bundleSha256,
            },
          })),
      ],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
