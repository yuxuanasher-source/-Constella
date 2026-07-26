import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  OrganizationMemberRecord,
  OrganizationMemberStatus,
} from "@/features/organizations/organization-service";
import type { AppRole } from "@/lib/rbac/roles";

import type { OrganizationLifecycleStatus } from "./platform-admin-contracts";
import { PlatformAdminConflictError } from "./platform-admin-errors";
import {
  type PlatformAdminMutationRepository,
  type PlatformOrganizationCreateResult,
  type PlatformOrganizationRecord,
} from "./platform-admin-organization-service";
import { SupabasePlatformAdminOperationLog } from "./platform-admin-operation-log";

type OrganizationRow = {
  id: string;
  name: string;
  code: string;
  lifecycle_status: OrganizationLifecycleStatus;
  updated_at: string;
};

type MemberRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: AppRole;
  status: OrganizationMemberStatus;
  created_at: string;
  updated_at: string;
  profiles:
    | { email: string | null; full_name: string | null; phone?: string | null }
    | Array<{
        email: string | null;
        full_name: string | null;
        phone?: string | null;
      }>
    | null;
};

type AtomicCreateResult = {
  organization_id: string;
  subscription_id: string;
  primary_user_id: string;
  order_id: string | null;
  transaction_id: string | null;
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

export class SupabasePlatformAdminMutationRepository implements PlatformAdminMutationRepository {
  readonly operationLog;

  constructor(private readonly client: SupabaseClient) {
    this.operationLog = new SupabasePlatformAdminOperationLog(client);
  }

  async createOrganizationAtomic(
    input: Parameters<
      PlatformAdminMutationRepository["createOrganizationAtomic"]
    >[0],
  ): Promise<PlatformOrganizationCreateResult> {
    const { data, error } = await this.client.rpc(
      "platform_create_organization",
      {
        p_actor_user_id: input.actorUserId,
        p_name: input.name,
        p_code: input.code,
        p_primary_user_id: input.primaryUserId,
        p_primary_email: input.primaryEmail,
        p_primary_name: input.primaryName,
        p_plan_id: input.planId,
        p_billing_cycle: input.billingCycle,
        p_period_start: input.periodStart,
        p_period_end: input.periodEnd,
        p_offline_payment: input.offlinePayment
          ? {
              amount_cents: input.offlinePayment.amountCents,
              currency: input.offlinePayment.currency,
              provider: input.offlinePayment.provider,
              provider_txn_id: input.offlinePayment.providerTransactionId,
              paid_at: input.offlinePayment.paidAt,
            }
          : null,
        p_reason: input.reason,
        p_trace_id: input.traceId,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: input.requestHash,
      },
    );
    throwIf(error, "create organization");
    return mapAtomicCreateResult(data as AtomicCreateResult);
  }

  async getOrganization(
    organizationId: string,
  ): Promise<PlatformOrganizationRecord | null> {
    const { data, error } = await this.client
      .from("organizations")
      .select("id, name, code, lifecycle_status, updated_at")
      .eq("id", organizationId)
      .maybeSingle<OrganizationRow>();
    throwIf(error, "load organization");
    return data ? mapOrganization(data) : null;
  }

  async updateOrganizationLifecycle(
    organizationId: string,
    status: OrganizationLifecycleStatus,
    expectedUpdatedAt: string,
  ) {
    const result = await this.client
      .from("organizations")
      .update({ lifecycle_status: status })
      .eq("id", organizationId)
      .eq("updated_at", expectedUpdatedAt)
      .select("id, name, code, lifecycle_status, updated_at")
      .maybeSingle<OrganizationRow>();
    return requireUpdated(result, "organization lifecycle", mapOrganization);
  }

  async updateOrganizationIdentity(
    organizationId: string,
    input: { name?: string; code?: string },
    expectedUpdatedAt: string,
  ) {
    const result = await this.client
      .from("organizations")
      .update(input)
      .eq("id", organizationId)
      .eq("updated_at", expectedUpdatedAt)
      .select("id, name, code, lifecycle_status, updated_at")
      .maybeSingle<OrganizationRow>();
    return requireUpdated(result, "organization", mapOrganization);
  }

  async createOrUpdateProfile(
    input: Parameters<
      PlatformAdminMutationRepository["createOrUpdateProfile"]
    >[0],
  ) {
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
    throwIf(error, "save member profile");
  }

  async createMembership(
    input: Parameters<PlatformAdminMutationRepository["createMembership"]>[0],
  ) {
    const { data, error } = await this.client
      .from("organization_members")
      .insert({
        organization_id: input.organizationId,
        user_id: input.userId,
        role: input.role,
        status: input.status,
      })
      .select(memberSelect)
      .single<MemberRow>();
    throwIf(error, "create organization member");
    return mapMember(data);
  }

  async getMember(organizationId: string, memberId: string) {
    const { data, error } = await this.client
      .from("organization_members")
      .select(memberSelect)
      .eq("organization_id", organizationId)
      .eq("id", memberId)
      .maybeSingle<MemberRow>();
    throwIf(error, "load organization member");
    return data ? mapMember(data) : null;
  }

  async updateMemberRole(
    organizationId: string,
    memberId: string,
    role: AppRole,
    expectedUpdatedAt: string,
  ) {
    const result = await this.client
      .from("organization_members")
      .update({ role })
      .eq("organization_id", organizationId)
      .eq("id", memberId)
      .eq("updated_at", expectedUpdatedAt)
      .select(memberSelect)
      .maybeSingle<MemberRow>();
    return requireUpdated(result, "member role", mapMember);
  }

  async updateMemberStatus(
    organizationId: string,
    memberId: string,
    status: OrganizationMemberStatus,
    expectedUpdatedAt: string,
  ) {
    const result = await this.client
      .from("organization_members")
      .update({ status })
      .eq("organization_id", organizationId)
      .eq("id", memberId)
      .eq("updated_at", expectedUpdatedAt)
      .select(memberSelect)
      .maybeSingle<MemberRow>();
    return requireUpdated(result, "member status", mapMember);
  }

  async isPrimaryAccount(organizationId: string, userId: string) {
    const { data, error } = await this.client
      .from("organization_primary_accounts")
      .select("organization_id")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle<{ organization_id: string }>();
    throwIf(error, "load primary account");
    return Boolean(data);
  }

  async countOtherActiveOwners(organizationId: string, userId: string) {
    const { count, error } = await this.client
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("role", "owner")
      .eq("status", "active")
      .neq("user_id", userId);
    throwIf(error, "count active owners");
    return count ?? 0;
  }
}

function mapOrganization(row: OrganizationRow): PlatformOrganizationRecord {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    lifecycleStatus: row.lifecycle_status,
    updatedAt: row.updated_at,
  };
}

function mapMember(row: MemberRow): OrganizationMemberRecord {
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

function mapAtomicCreateResult(
  result: AtomicCreateResult,
): PlatformOrganizationCreateResult {
  return {
    organizationId: result.organization_id,
    subscriptionId: result.subscription_id,
    primaryUserId: result.primary_user_id,
    orderId: result.order_id,
    transactionId: result.transaction_id,
  };
}

function requireUpdated<Row, Result>(
  result: { data: Row | null; error: { message: string } | null },
  subject: string,
  map: (row: Row) => Result,
): Result {
  throwIf(result.error, `update ${subject}`);
  if (!result.data) {
    throw new PlatformAdminConflictError(
      `The ${subject} changed after it was loaded. Refresh and try again.`,
    );
  }
  return map(result.data);
}

function throwIf(
  error: { message: string } | null,
  operation: string,
): asserts error is null {
  if (error) {
    throw new Error(`Failed to ${operation}: ${error.message}`);
  }
}
