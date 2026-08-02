import {
  AuthInvalidJwtError,
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { cache } from "react";

import {
  normalizePublishedBrand,
  type PublishedOrganizationBrand,
} from "@/features/organizations/organization-brand";
import { appRoles, type AppRole } from "@/lib/rbac/roles";

export type OrganizationBranding = PublishedOrganizationBrand;

export type AuthContext = {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  organizationBranding?: OrganizationBranding | null;
  avatarText?: string | null;
  avatarUrl?: string | null;
  role: AppRole;
  requiresOnboarding?: boolean;
};

export class AuthContextUnavailableError extends Error {
  constructor() {
    super("Authentication context is unavailable");
    this.name = "AuthContextUnavailableError";
  }
}

const invalidSessionCodes = new Set([
  "bad_jwt",
  "session_not_found",
  "session_expired",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "no_authorization",
]);

const infrastructureAuthCodes = new Set([
  "request_timeout",
  "hook_timeout",
  "hook_timeout_after_retry",
  "over_request_rate_limit",
  "over_email_send_rate_limit",
  "over_sms_send_rate_limit",
]);

function isRejectedSessionError(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) {
    return true;
  }
  if (isAuthRetryableFetchError(error)) {
    return false;
  }
  if (error instanceof AuthInvalidJwtError) {
    return true;
  }
  if (!isAuthApiError(error)) {
    return false;
  }
  if (error.status >= 500 || infrastructureAuthCodes.has(error.code ?? "")) {
    return false;
  }
  return (
    invalidSessionCodes.has(error.code ?? "") ||
    error.status === 401 ||
    error.status === 403
  );
}

type OrganizationRow = {
  name: string;
  branding?: unknown;
};

type MembershipRow = {
  organization_id: string;
  role: AppRole;
  organizations: OrganizationRow | OrganizationRow[] | null;
  created_at?: string | null;
};

type ProfileRow = {
  full_name: string;
  requires_onboarding: boolean;
  avatar_text?: string | null;
  avatar_url?: string | null;
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

// React.cache: 同一次 SSR 请求内以 client 实例为键去重 GoTrue /user 调用。
// layout 的 requireAuthenticatedUser 与 page 的 getAuthContext 共用这份缓存，
// 每次 SSR 只打一次 auth.getUser 网络请求。渲染上下文之外 cache 退化为直接
// 调用，语义不变。
export const getAuthenticatedUser = cache(async function getAuthenticatedUser(
  supabase: SupabaseClient,
): Promise<User | null> {
  let result: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    result = await supabase.auth.getUser();
  } catch {
    throw new AuthContextUnavailableError();
  }

  if (result.error) {
    if (isRejectedSessionError(result.error)) {
      return null;
    }
    throw new AuthContextUnavailableError();
  }

  return result.data.user ?? null;
});

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

  const user = await getAuthenticatedUser(supabase);

  if (!user?.id || !user.email) {
    return null;
  }

  const [profileResult, membershipResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, requires_onboarding, avatar_text, avatar_url")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>(),
    supabase
      .from("organization_members")
      .select(
        "organization_id, role, organizations(name, branding), created_at",
      )
      .eq("user_id", user.id)
      .eq("status", "active")
      // Deterministic primary-org selection: earliest joined, stable id
      // tie-break. Role within the org is disambiguated in JS by privilege.
      .order("created_at", { ascending: true })
      .order("organization_id", { ascending: true })
      .returns<MembershipRow[]>(),
  ]).catch(() => {
    throw new AuthContextUnavailableError();
  });

  if (profileResult.error || membershipResult.error) {
    throw new AuthContextUnavailableError();
  }

  const profile = profileResult.data;
  const membership = pickPrimaryMembership(membershipResult.data ?? []);

  if (!membership) {
    return null;
  }

  const organization = Array.isArray(membership.organizations)
    ? membership.organizations[0]
    : membership.organizations;
  const organizationName = organization?.name ?? "未选择组织";

  return {
    userId: user.id,
    email: user.email,
    name: profile?.full_name ?? user.email,
    organizationId: membership.organization_id,
    organizationName,
    organizationBranding: normalizePublishedBrand(organization?.branding, {
      organizationId: membership.organization_id,
      organizationName,
    }),
    avatarText: profile?.avatar_text ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    role: membership.role,
    requiresOnboarding: profile?.requires_onboarding ?? false,
  };
});
