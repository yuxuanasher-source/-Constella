import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  OrganizationMemberRecord,
  OrganizationMemberRepository,
  OrganizationMemberStatus,
} from "./organization-service";

import type { AppRole } from "@/lib/rbac/roles";

type ProfileRelation =
  | { email: string | null; full_name: string | null; phone?: string | null }
  | { email: string | null; full_name: string | null; phone?: string | null }[]
  | null;

type OrganizationMemberRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: AppRole;
  status: OrganizationMemberStatus;
  created_at: string;
  updated_at: string;
  profiles?: ProfileRelation;
};

const memberSelect = `
  id,
  organization_id,
  user_id,
  role,
  status,
  created_at,
  updated_at,
  profiles(email, full_name, phone)
`;

export class SupabaseOrganizationMemberRepository
  implements OrganizationMemberRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async listMembers(
    organizationId: string,
  ): Promise<OrganizationMemberRecord[]> {
    const { data, error } = await this.client
      .from("organization_members")
      .select(memberSelect)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    return ((data ?? []) as OrganizationMemberRow[]).map(toMemberRecord);
  }

  async createOrUpdateProfile(input: {
    userId: string;
    email: string;
    name: string;
    phone?: string | null;
    loginAccount?: string | null;
    requiresOnboarding?: boolean;
  }): Promise<void> {
    const { error } = await this.client.from("profiles").upsert(
      {
        id: input.userId,
        email: input.email,
        full_name: input.name,
        phone: input.phone ?? null,
        login_account: input.loginAccount ?? null,
        requires_onboarding: input.requiresOnboarding ?? false,
      },
      { onConflict: "id" },
    );

    if (error) {
      throw error;
    }
  }

  async createMembership(input: {
    organizationId: string;
    userId: string;
    role: AppRole;
    status: OrganizationMemberStatus;
  }): Promise<OrganizationMemberRecord> {
    const { data, error } = await this.client
      .from("organization_members")
      .upsert(
        {
          organization_id: input.organizationId,
          user_id: input.userId,
          role: input.role,
          status: input.status,
        },
        { onConflict: "organization_id,user_id" },
      )
      .select(memberSelect)
      .single<OrganizationMemberRow>();

    if (error) {
      throw error;
    }

    return toMemberRecord(data);
  }

  async getMemberById(
    organizationId: string,
    memberId: string,
  ): Promise<OrganizationMemberRecord | null> {
    const { data, error } = await this.client
      .from("organization_members")
      .select(memberSelect)
      .eq("organization_id", organizationId)
      .eq("id", memberId)
      .maybeSingle<OrganizationMemberRow>();

    if (error) {
      throw error;
    }

    return data ? toMemberRecord(data) : null;
  }

  async updateMemberRole(
    organizationId: string,
    memberId: string,
    input: { role: AppRole },
  ): Promise<OrganizationMemberRecord> {
    const { data, error } = await this.client
      .from("organization_members")
      .update({ role: input.role })
      .eq("organization_id", organizationId)
      .eq("id", memberId)
      .select(memberSelect)
      .single<OrganizationMemberRow>();

    if (error) {
      throw error;
    }

    return toMemberRecord(data);
  }

  async updateMemberStatus(
    organizationId: string,
    memberId: string,
    input: { status: OrganizationMemberStatus },
  ): Promise<OrganizationMemberRecord> {
    const { data, error } = await this.client
      .from("organization_members")
      .update({ status: input.status })
      .eq("organization_id", organizationId)
      .eq("id", memberId)
      .select(memberSelect)
      .single<OrganizationMemberRow>();

    if (error) {
      throw error;
    }

    return toMemberRecord(data);
  }
}

function toMemberRecord(row: OrganizationMemberRow): OrganizationMemberRecord {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;

  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    email: profile?.email ?? "",
    phone: profile?.phone ?? undefined,
    name: profile?.full_name ?? profile?.email ?? "未命名成员",
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
