import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppRole } from "@/lib/rbac/roles";

export type AuthContext = {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  role: AppRole;
  requiresOnboarding?: boolean;
};

type MembershipRow = {
  organization_id: string;
  role: AppRole;
  organizations: { name: string } | { name: string }[] | null;
};

type ProfileRow = {
  full_name: string;
  requires_onboarding: boolean;
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

  const [profileResult, membershipResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, requires_onboarding")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>(),
    supabase
      .from("organization_members")
      .select("organization_id, role, organizations(name)")
      .eq("user_id", user.id)
      .eq("status", "active")
      // A user can belong to more than one active organization. Until an
      // explicit active-org switcher exists, pick deterministically (earliest
      // joined, then a stable id tie-break) so the same user always resolves to
      // the same organization instead of an arbitrary row.
      .order("created_at", { ascending: true })
      .order("organization_id", { ascending: true })
      .limit(1)
      .maybeSingle<MembershipRow>(),
  ]);

  const profile = profileResult.data;
  const membership = membershipResult.data;

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
    requiresOnboarding: profile?.requires_onboarding ?? false,
  };
}
