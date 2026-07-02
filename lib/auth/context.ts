import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";

import { appRoles, type AppRole } from "@/lib/rbac/roles";

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
  created_at?: string | null;
};

type ProfileRow = {
  full_name: string;
  requires_onboarding: boolean;
};

// appRoles is declared most→least privileged, so its index is a priority rank
// (owner = 0 … streamer = 4).
function rolePriority(role: AppRole): number {
  const index = appRoles.indexOf(role);
  return index === -1 ? appRoles.length : index;
}

// A user can hold several active memberships — even multiple rows in the SAME
// organization (e.g. both `owner` and `streamer`). Memberships arrive ordered
// by created_at then organization_id, so the first row's org is the primary
// (earliest-joined) one. Within that org pick the MOST privileged role:
// otherwise the role resolves non-deterministically and the console flips
// between staff and streamer views, making data appear to vanish on refresh.
function pickPrimaryMembership(
  memberships: MembershipRow[],
): MembershipRow | null {
  if (memberships.length === 0) {
    return null;
  }
  const primaryOrganizationId = memberships[0].organization_id;
  return memberships
    .filter((m) => m.organization_id === primaryOrganizationId)
    .reduce((best, current) =>
      rolePriority(current.role) < rolePriority(best.role) ? current : best,
    );
}

// React.cache: 同一次 SSR 请求内以 client 实例为键去重。配合请求级缓存的
// createSupabaseServerClient（同请求返回同一实例），layout 与 page 各自调用
// getAuthContext 时只会真正执行一次 auth.getUser + profiles/memberships 查询。
// 传入不同实例（如测试或 admin client）时各自独立执行，语义不变。
export const getAuthContext = cache(async function getAuthContext(
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
      .select("organization_id, role, organizations(name), created_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      // Deterministic primary-org selection: earliest joined, stable id
      // tie-break. Role within the org is disambiguated in JS by privilege.
      .order("created_at", { ascending: true })
      .order("organization_id", { ascending: true })
      .returns<MembershipRow[]>(),
  ]);

  const profile = profileResult.data;
  const membership = pickPrimaryMembership(membershipResult.data ?? []);

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
});
