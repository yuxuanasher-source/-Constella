import { NextResponse } from "next/server";

import {
  LEGACY_HERMES_KERNEL_ID,
  LEGACY_HERMES_PROFILE_VERSION,
} from "@/features/ai/hermes/contracts";
import { getAllowedReadScopesForRole } from "@/features/ai/hermes/read-scopes";
import {
  HERMES_BUILTIN_SKILL_CATALOG,
  evaluateHermesSkillGrantsForActor,
} from "@/features/ai/hermes/skill-governance";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

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
  const evaluation = evaluateHermesSkillGrantsForActor({
    role: auth.role,
    allowedReadScopes,
  });
  const decisionsBySkillId = new Map(
    evaluation.decisions.map((decision) => [decision.skillId, decision]),
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
      skillGrantsHash: evaluation.skillGrantsHash,
      skills: HERMES_BUILTIN_SKILL_CATALOG.map((skill) => {
        const decision = decisionsBySkillId.get(skill.skillId);
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
        };
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
