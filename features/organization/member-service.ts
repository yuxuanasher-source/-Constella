import type { SupabaseClient } from "@supabase/supabase-js";

import type { OrgMemberDto } from "./member-queries";

export const ASSIGNABLE_ROLES = [
  "owner",
  "ops_manager",
  "operator_business",
  "finance",
  "streamer",
] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

function assertRole(role: string): asserts role is AssignableRole {
  if (!ASSIGNABLE_ROLES.includes(role as AssignableRole)) {
    throw new Error(`Unsupported role: ${role}`);
  }
}

export async function updateMemberRole({
  admin,
  organizationId,
  userId,
  role,
}: {
  admin: SupabaseClient;
  organizationId: string;
  userId: string;
  role: string;
}): Promise<void> {
  assertRole(role);
  const { error } = await admin
    .from("organization_members")
    .update({ role })
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (error) {
    throw error;
  }
}

export async function inviteMember({
  admin,
  organizationId,
  email,
  name,
  role,
}: {
  admin: SupabaseClient;
  organizationId: string;
  email: string;
  name: string;
  role: string;
}): Promise<OrgMemberDto> {
  assertRole(role);
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("邮箱不能为空");
  }
  const fullName = name.trim() || normalizedEmail.split("@")[0];

  // Provision a login account (org members reference auth.users via profiles).
  const created = await admin.auth.admin.createUser({
    email: normalizedEmail,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    password: `Inv-${crypto.randomUUID()}`,
  });
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message || "创建账号失败");
  }
  const userId = created.data.user.id;

  const profileResult = await admin
    .from("profiles")
    .upsert({ id: userId, email: normalizedEmail, full_name: fullName })
    .eq("id", userId);
  if (profileResult.error) {
    throw profileResult.error;
  }

  const membershipResult = await admin
    .from("organization_members")
    .insert({
      organization_id: organizationId,
      user_id: userId,
      role,
      status: "invited",
    });
  if (membershipResult.error) {
    throw membershipResult.error;
  }

  return {
    userId,
    name: fullName,
    email: normalizedEmail,
    role,
    status: "invited",
    joinedAt: null,
  };
}
