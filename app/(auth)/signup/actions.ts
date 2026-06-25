"use server";

import { redirect } from "next/navigation";

import { recordFunnelEvent } from "@/features/funnel/funnel-events";
import { getAuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

/**
 * 自助注册即试用：注册 auth user → provision_self_serve_org（事务化建 org +
 * member + trial 订阅）→ 落 signup_completed 埋点 → 进入 onboarding。
 */
export async function signUpAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirect("/signup?error=config");
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const companyName = String(formData.get("companyName") ?? "").trim();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const anonymousId = String(formData.get("anonymousId") ?? "").trim() || undefined;

  if (!email || !password || !companyName) {
    redirect("/signup?error=invalid");
  }

  const { error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError) {
    redirect("/signup?error=auth");
  }

  const { data: orgId, error: provisionError } = await supabase.rpc(
    "provision_self_serve_org",
    { p_org_name: companyName, p_full_name: fullName || null },
  );
  if (provisionError) {
    redirect("/signup?error=provision");
  }

  try {
    const context = await getAuthContext(supabase);
    if (context) {
      await recordFunnelEvent(supabase, {
        event: "signup_completed",
        organizationId: context.organizationId,
        userId: context.userId,
        anonymousId,
      });
      await writeAuditLog(supabase, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        actorName: context.name,
        actorRole: context.role,
        action: "create",
        module: "billing",
        objectType: "organization_subscription",
        objectId: typeof orgId === "string" ? orgId : undefined,
        after: { status: "trialing", source: "self_serve" },
      });
    }
  } catch {
    // 副作用失败不阻断进入产品；后续可由对账 / 回填补偿。
  }

  redirect("/onboarding");
}
