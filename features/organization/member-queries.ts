import type { SupabaseClient } from "@supabase/supabase-js";

export type OrgMemberDto = {
  userId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  joinedAt: string | null;
};

type MemberRow = {
  user_id: string;
  role: string;
  status: string;
  created_at: string | null;
  profiles:
    | { full_name: string | null; email: string | null }
    | { full_name: string | null; email: string | null }[]
    | null;
};

export async function listOrgMembers(
  supabase: SupabaseClient | null,
  organizationId: string,
): Promise<OrgMemberDto[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("organization_members")
    .select("user_id, role, status, created_at, profiles(full_name, email)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as MemberRow[]).map((row) => {
    const profile = Array.isArray(row.profiles)
      ? row.profiles[0]
      : row.profiles;
    return {
      userId: row.user_id,
      name: profile?.full_name ?? "未命名成员",
      email: profile?.email ?? "",
      role: row.role,
      status: row.status,
      joinedAt: row.created_at ?? null,
    };
  });
}
