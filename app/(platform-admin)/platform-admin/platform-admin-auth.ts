import { redirect } from "next/navigation";

import { getPlatformAdminContext } from "@/features/platform-admin/platform-admin-auth";
import { getAuthenticatedUser } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export async function requirePlatformAdminPage() {
  const sessionClient = await createSupabaseServerClient();
  if (!sessionClient) {
    redirect("/platform-admin/login?error=config");
  }

  const user = await getAuthenticatedUser(sessionClient);
  if (!user) {
    redirect("/platform-admin/login");
  }

  const context = await getPlatformAdminContext();
  if (!context) {
    redirect("/");
  }

  return context;
}
