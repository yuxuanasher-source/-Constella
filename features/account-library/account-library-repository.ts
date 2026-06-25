import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AccountLibraryRepository,
  CreatePlatformAccountRepositoryInput,
  PlatformAccountRecord,
  PlatformAccountStatus,
  PlatformAccountType,
} from "./account-library-service";

type PlatformAccountRow = {
  id: string;
  organization_id: string;
  platform: string;
  account_source: string | null;
  account_uid: string;
  xingtu_id: string | null;
  cooperation_code: string | null;
  account_type: PlatformAccountType;
  status: PlatformAccountStatus;
  real_name_holder: string | null;
  real_name_phone: string | null;
  operator_id: string | null;
  bound_streamer_id: string | null;
  note: string | null;
};

const accountSelect =
  "id, organization_id, platform, account_source, account_uid, xingtu_id, cooperation_code, account_type, status, real_name_holder, real_name_phone, operator_id, bound_streamer_id, note";

export class SupabaseAccountLibraryRepository
  implements AccountLibraryRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async createAccount(
    input: CreatePlatformAccountRepositoryInput,
  ): Promise<PlatformAccountRecord> {
    const insertPayload: Record<string, unknown> = {
      organization_id: input.organizationId,
      created_by: input.actorUserId,
      platform: input.platform,
      account_uid: input.accountUid,
      account_type: input.accountType,
      status: input.status,
      account_source: input.accountSource ?? null,
      xingtu_id: input.xingtuId ?? null,
      cooperation_code: input.cooperationCode ?? null,
      real_name_holder: input.realNameHolder ?? null,
      real_name_phone: input.realNamePhone ?? null,
      operator_id: input.operatorId ?? null,
      bound_streamer_id: input.boundStreamerId ?? null,
      note: input.note ?? null,
    };

    const { data, error } = await this.client
      .from("platform_accounts")
      .insert(insertPayload)
      .select(accountSelect)
      .single<PlatformAccountRow>();

    if (error) {
      throw error;
    }

    return toPlatformAccountRecord(data);
  }

  async getById(accountId: string): Promise<PlatformAccountRecord | null> {
    const { data, error } = await this.client
      .from("platform_accounts")
      .select(accountSelect)
      .eq("id", accountId)
      .maybeSingle<PlatformAccountRow>();

    if (error) {
      throw error;
    }

    return data ? toPlatformAccountRecord(data) : null;
  }

  async updateAccount(
    accountId: string,
    patch: Record<string, unknown>,
  ): Promise<PlatformAccountRecord> {
    const { data, error } = await this.client
      .from("platform_accounts")
      .update(patch)
      .eq("id", accountId)
      .select(accountSelect)
      .single<PlatformAccountRow>();

    if (error) {
      throw error;
    }

    return toPlatformAccountRecord(data);
  }
}

function toPlatformAccountRecord(
  row: PlatformAccountRow,
): PlatformAccountRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    platform: row.platform,
    accountSource: row.account_source,
    accountUid: row.account_uid,
    xingtuId: row.xingtu_id,
    cooperationCode: row.cooperation_code,
    accountType: row.account_type,
    status: row.status,
    realNameHolder: row.real_name_holder,
    realNamePhone: row.real_name_phone,
    operatorId: row.operator_id,
    boundStreamerId: row.bound_streamer_id,
    note: row.note,
  };
}
