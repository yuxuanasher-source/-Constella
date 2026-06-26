import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppRole } from "@/lib/rbac/roles";

export type AuthContext = {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  role: AppRole;
};

type MembershipRow = {
  organization_id: string;
  role: AppRole;
  organizations: { name: string } | { name: string }[] | null;
};

type ProfileRow = {
  full_name: string;
};

export async function getAuthContext(
  supabase: SupabaseClient | null,
): Promise<AuthContext | null> {
  if (!supabase) {
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id || !user.email) {
    return null;
  }

  // The profile and membership lookups both depend only on user.id and are
  // independent of each other, so resolve them in parallel to save a round trip
  // on the hot path every authenticated request goes through.
  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>(),
    supabase
      .from("organization_members")
      .select("organization_id, role, organizations(name)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle<MembershipRow>(),
  ]);

  if (!membership) {
    return null;
  }

  const organization = Array.isArray(membership.organizations)
    ? membership.organizations[0]
    : membership.organizations;

  return {
    userId: user.id,
    email: user.email,
    name: profile?.full_name ?? user.email,
    organizationId: membership.organization_id,
    organizationName: organization?.name ?? "未选择组织",
    role: membership.role,
  };
}
