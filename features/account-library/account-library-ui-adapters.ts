import type { AppRole } from "@/lib/rbac/roles";

import type { PlatformAccountListRow } from "./account-library-queries";
import type {
  PlatformAccountStatus,
  PlatformAccountType,
} from "./account-library-service";

export type PlatformAccountDto = {
  id: string;
  platform: string;
  accountSource: string | null;
  accountUid: string;
  xingtuId: string | null;
  cooperationCode: string | null;
  accountType: PlatformAccountType;
  status: PlatformAccountStatus;
  realNameHolder: string | null;
  realNamePhone: string | null;
  realNamePhoneMasked: boolean;
  operatorId: string | null;
  boundStreamerId: string | null;
  note: string | null;
  createdAt: string;
};

// 仅 owner/ops_manager 可见实名手机号明文，其余角色一律掩码。
function canViewRealNamePhone(role: AppRole): boolean {
  return role === "owner" || role === "ops_manager";
}

export function maskPhone(phone: string | null): string | null {
  if (!phone) {
    return phone;
  }
  if (phone.length <= 4) {
    return "****";
  }
  return `${phone.slice(0, 3)}****${phone.slice(-2)}`;
}

export function toPlatformAccountDto(
  row: PlatformAccountListRow,
  role: AppRole,
): PlatformAccountDto {
  const showPhone = canViewRealNamePhone(role);
  return {
    id: row.id,
    platform: row.platform,
    accountSource: row.account_source,
    accountUid: row.account_uid,
    xingtuId: row.xingtu_id,
    cooperationCode: row.cooperation_code,
    accountType: row.account_type,
    status: row.status,
    realNameHolder: row.real_name_holder,
    realNamePhone: showPhone
      ? row.real_name_phone
      : maskPhone(row.real_name_phone),
    realNamePhoneMasked: !showPhone,
    operatorId: row.operator_id,
    boundStreamerId: row.bound_streamer_id,
    note: row.note,
    createdAt: row.created_at,
  };
}

export function toPlatformAccountDtos(
  rows: PlatformAccountListRow[],
  role: AppRole,
): PlatformAccountDto[] {
  return rows.map((row) => toPlatformAccountDto(row, role));
}
