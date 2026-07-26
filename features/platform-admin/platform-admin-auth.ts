import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthenticatedUser } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

export type PlatformAdminContext = {
  userId: string;
  email: string;
  name: string;
  role: "super_admin";
};

type PlatformAdminRow = {
  role: string;
  status: string;
};

type ProfileRow = {
  full_name: string;
};

export async function resolvePlatformAdminContext(input: {
  sessionClient: SupabaseClient | null;
  adminClient: SupabaseClient | null;
  now?: Date;
}): Promise<PlatformAdminContext | null> {
  const { sessionClient, adminClient } = input;
  if (!sessionClient || !adminClient) {
    return null;
  }

  try {
    const user = await getAuthenticatedUser(sessionClient);
    if (!user?.id || !user.email) {
      return null;
    }

    const { data: admin, error: adminError } = await adminClient
      .from("platform_admins")
      .select("role, status")
      .eq("user_id", user.id)
      .maybeSingle<PlatformAdminRow>();

    if (
      adminError ||
      !admin ||
      admin.role !== "super_admin" ||
      admin.status !== "active"
    ) {
      return null;
    }

    const { data: profile } = await adminClient
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>();

    await adminClient
      .from("platform_admins")
      .update({
        last_access_at: (input.now ?? new Date()).toISOString(),
      })
      .eq("user_id", user.id);

    return {
      userId: user.id,
      email: user.email,
      name: profile?.full_name ?? user.email,
      role: "super_admin",
    };
  } catch {
    return null;
  }
}

export async function getPlatformAdminContext(): Promise<PlatformAdminContext | null> {
  return resolvePlatformAdminContext({
    sessionClient: await createSupabaseServerClient(),
    adminClient: createSupabaseAdminClient(),
  });
}
