import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolvePostLoginPath } from "@/app/(auth)/login/login-workflows";
import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";
import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function requireConsoleStaffAuth() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirect("/login?error=config");
  }

  const auth = await getAuthContext(supabase);

  if (!auth) {
    redirect("/login");
  }

  if (!isMcnStaff(auth.role)) {
    redirect(
      resolvePostLoginPath({
        role: auth.role,
        roleIntent: auth.role === "streamer" ? "streamer" : "mcn",
      }),
    );
  }

  return { supabase, auth };
}

export function currentUserFromAuth(auth: AuthContext) {
  return {
    id: auth.userId,
    name: auth.name,
    role: auth.role,
    org: auth.organizationName,
    organizationId: auth.organizationId,
    dept: auth.organizationName,
  };
}

export function organizationSettingsFromAuth(auth: AuthContext) {
  return { name: auth.organizationName };
}

// 加载当前角色的经营闭环看板 DTO，供作战台（ScreenRoleHome）渲染。
// 任何渲染参考 UI 的 console 页面都应传入它，否则作战台会回退到旧版页签。
// 失败时降级为 null，不影响页面其余部分。
export async function loadConsoleDashboardHome(
  supabase: SupabaseClient,
  auth: AuthContext,
) {
  try {
    return await loadRoleHomeDashboard({ supabase, auth });
  } catch (error) {
    console.error("Failed to load role dashboard", error);
    return null;
  }
}
