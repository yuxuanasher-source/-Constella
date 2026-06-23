import { NextResponse } from "next/server";

import { SupabaseAccountLibraryRepository } from "@/features/account-library/account-library-repository";
import {
  PLATFORM_ACCOUNT_STATUSES,
  PLATFORM_ACCOUNT_TYPES,
  updatePlatformAccount,
  type PlatformAccountStatus,
  type PlatformAccountType,
  type UpdatePlatformAccountInput,
} from "@/features/account-library/account-library-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { accountId } = await params;
    const account = await new SupabaseAccountLibraryRepository(
      supabase,
    ).getById(accountId);
    if (!account) {
      return NextResponse.json(
        { error: "Platform account not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ account });
  } catch (error) {
    return jsonServiceError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as AccountPatchBody;

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

    const input: UpdatePlatformAccountInput = {};
    if (body.platform !== undefined) {
      input.platform = typeof body.platform === "string" ? body.platform : "";
    }
    if (accountType) input.accountType = accountType as PlatformAccountType;
    if (status) input.status = status as PlatformAccountStatus;
    if (body.accountSource !== undefined) {
      input.accountSource = asNullableText(body.accountSource);
    }
    if (body.xingtuId !== undefined) {
      input.xingtuId = asNullableText(body.xingtuId);
    }
    if (body.cooperationCode !== undefined) {
      input.cooperationCode = asNullableText(body.cooperationCode);
    }
    if (body.realNameHolder !== undefined) {
      input.realNameHolder = asNullableText(body.realNameHolder);
    }
    if (body.realNamePhone !== undefined) {
      input.realNamePhone = asNullableText(body.realNamePhone);
    }
    if (body.operatorId !== undefined) {
      input.operatorId = asNullableText(body.operatorId);
    }
    if (body.note !== undefined) {
      input.note = asNullableText(body.note);
    }

    const { accountId } = await params;
    const account = await updatePlatformAccount({
      repo: new SupabaseAccountLibraryRepository(supabase),
      audit: (auditInput) => writeAuditLog(supabase, auditInput),
      actor: auth,
      accountId,
      input,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });

    return NextResponse.json({ account });
  } catch (error) {
    return jsonServiceError(error);
  }
}

type AccountPatchBody = {
  platform?: unknown;
  accountSource?: unknown;
  xingtuId?: unknown;
  cooperationCode?: unknown;
  accountType?: unknown;
  status?: unknown;
  realNameHolder?: unknown;
  realNamePhone?: unknown;
  operatorId?: unknown;
  note?: unknown;
  reason?: unknown;
};

function asNullableText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeEnumOrResponse<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fieldName: string,
) {
  if (value === undefined) {
    return undefined;
  }
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized && allowedValues.includes(normalized as T)) {
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
