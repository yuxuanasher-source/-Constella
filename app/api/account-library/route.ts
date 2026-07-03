import { NextResponse } from "next/server";

import {
  listPlatformAccounts,
  type AccountLibraryFilter,
} from "@/features/account-library/account-library-queries";
import { SupabaseAccountLibraryRepository } from "@/features/account-library/account-library-repository";
import {
  createPlatformAccount,
  PLATFORM_ACCOUNT_STATUSES,
  PLATFORM_ACCOUNT_TYPES,
  type PlatformAccountStatus,
  type PlatformAccountType,
} from "@/features/account-library/account-library-service";
import { toPlatformAccountDtos } from "@/features/account-library/account-library-ui-adapters";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const filter: AccountLibraryFilter = {};
    const platform = normalizeOptionalText(url.searchParams.get("platform"));
    if (platform) filter.platform = platform;
    const accountType = normalizeEnum(
      url.searchParams.get("accountType"),
      PLATFORM_ACCOUNT_TYPES,
    );
    if (accountType) filter.accountType = accountType;
    const status = normalizeEnum(
      url.searchParams.get("status"),
      PLATFORM_ACCOUNT_STATUSES,
    );
    if (status) filter.status = status;
    const operatorId = normalizeOptionalText(url.searchParams.get("operatorId"));
    if (operatorId) filter.operatorId = operatorId;
    const boundStreamerId = normalizeOptionalText(
      url.searchParams.get("boundStreamerId"),
    );
    if (boundStreamerId) filter.boundStreamerId = boundStreamerId;
    const projectId = normalizeOptionalText(url.searchParams.get("projectId"));
    if (projectId) filter.projectId = projectId;

    const rows = await listPlatformAccounts(supabase, filter);
    return NextResponse.json({
      accounts: toPlatformAccountDtos(rows, auth.role),
    });
  } catch (error) {
    return jsonServiceError(error);
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as AccountPostBody;
    const platform = normalizeOptionalText(body.platform);
    if (!platform) {
      return NextResponse.json(
        { error: "platform is required" },
        { status: 400 },
      );
    }
    const accountUid = normalizeOptionalText(body.accountUid);
    if (!accountUid) {
      return NextResponse.json(
        { error: "accountUid is required" },
        { status: 400 },
      );
    }

    const accountType = normalizeEnumOrResponse(
      body.accountType,
      PLATFORM_ACCOUNT_TYPES,
      "accountType",
    );
    if (accountType instanceof Response) {
      return accountType;
    }
    const status = normalizeEnumOrResponse(
      body.status,
      PLATFORM_ACCOUNT_STATUSES,
      "status",
    );
    if (status instanceof Response) {
      return status;
    }

    const account = await createPlatformAccount({
      repo: new SupabaseAccountLibraryRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor: auth,
      input: {
        platform,
        accountUid,
        accountSource: normalizeOptionalText(body.accountSource),
        xingtuId: normalizeOptionalText(body.xingtuId),
        cooperationCode: normalizeOptionalText(body.cooperationCode),
        accountType: accountType as PlatformAccountType | undefined,
        status: status as PlatformAccountStatus | undefined,
        realNameHolder: normalizeOptionalText(body.realNameHolder),
        realNamePhone: normalizeOptionalText(body.realNamePhone),
        securityPhone: normalizeOptionalText(body.securityPhone),
        securityEmail: normalizeOptionalText(body.securityEmail),
        followerCount: normalizeOptionalNumber(body.followerCount),
        projectId: normalizeOptionalText(body.projectId),
        operatorId: normalizeOptionalText(body.operatorId),
        boundStreamerId: normalizeOptionalText(body.boundStreamerId),
        note: normalizeOptionalText(body.note),
      },
    });

    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    return jsonServiceError(error);
  }
}

type AccountPostBody = {
  platform?: unknown;
  accountUid?: unknown;
  accountSource?: unknown;
  xingtuId?: unknown;
  cooperationCode?: unknown;
  accountType?: unknown;
  status?: unknown;
  realNameHolder?: unknown;
  realNamePhone?: unknown;
  securityPhone?: unknown;
  securityEmail?: unknown;
  followerCount?: unknown;
  projectId?: unknown;
  operatorId?: unknown;
  boundStreamerId?: unknown;
  note?: unknown;
};

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeOptionalNumber(value: unknown) {
  if (typeof value !== "number") {
    return undefined;
  }
  return value;
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
): T | undefined {
  const normalized = normalizeOptionalText(value);
  if (normalized && allowedValues.includes(normalized as T)) {
    return normalized as T;
  }
  return undefined;
}

function normalizeEnumOrResponse<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fieldName: string,
) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return undefined;
  }
  if (allowedValues.includes(normalized as T)) {
    return normalized as T;
  }
  return NextResponse.json(
    { error: `${fieldName} is invalid` },
    { status: 400 },
  );
}

function jsonServiceError(error: unknown) {
  if (error instanceof Error) {
    return NextResponse.json(
      { error: error.message },
      { status: statusForServiceError(error) },
    );
  }
  return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
}
