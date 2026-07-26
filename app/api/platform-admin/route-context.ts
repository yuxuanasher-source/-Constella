import { resolvePlatformAdminContext } from "@/features/platform-admin/platform-admin-auth";
import { SupabasePlatformAdminRepository } from "@/features/platform-admin/platform-admin-repository-supabase";
import { getAuthenticatedUser } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

export async function getPlatformAdminRouteContext() {
  const sessionClient = await createSupabaseServerClient();
  if (!sessionClient) {
    return { ok: false as const, status: 401 as const };
  }

  const user = await getAuthenticatedUser(sessionClient);
  if (!user) {
    return { ok: false as const, status: 401 as const };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { ok: false as const, status: 503 as const };
  }

  const actor = await resolvePlatformAdminContext({
    sessionClient,
    adminClient: admin,
  });
  if (!actor) {
    return { ok: false as const, status: 403 as const };
  }

  return {
    ok: true as const,
    actor,
    admin,
    repo: new SupabasePlatformAdminRepository(admin),
  };
}
