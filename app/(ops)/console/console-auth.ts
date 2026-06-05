import { redirect } from "next/navigation";

import { resolvePostLoginPath } from "@/app/(auth)/login/login-workflows";
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
    dept: auth.organizationName,
  };
}

export function organizationSettingsFromAuth(auth: AuthContext) {
  return { name: auth.organizationName };
}
