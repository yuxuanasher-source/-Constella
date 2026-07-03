import { NextResponse } from "next/server";

import { transitionPlatformAccountStatus } from "@/features/account-library/account-lifecycle-service";
import { SupabaseAccountLibraryRepository } from "@/features/account-library/account-library-repository";
import {
  getAccountLibraryRouteContext,
  jsonServiceError,
} from "@/features/account-library/account-library-route-utils";
import {
  PLATFORM_ACCOUNT_STATUSES,
  type PlatformAccountStatus,
} from "@/features/account-library/account-library-service";
import { writeAuditLog } from "@/lib/audit/audit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const context = await getAccountLibraryRouteContext();
    if (context instanceof NextResponse) {
      return context;
    }
    const { supabase, auth } = context;

    const body = (await request.json().catch(() => ({}))) as {
      toStatus?: unknown;
      reason?: unknown;
      banSource?: unknown;
    };

    const toStatus =
      typeof body.toStatus === "string" ? body.toStatus.trim() : "";
    if (
      !PLATFORM_ACCOUNT_STATUSES.includes(toStatus as PlatformAccountStatus)
    ) {
      return NextResponse.json(
        { error: "toStatus is invalid" },
        { status: 400 },
      );
    }

    const { accountId } = await params;
    const account = await transitionPlatformAccountStatus({
      repo: new SupabaseAccountLibraryRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor: auth,
      accountId,
      toStatus: toStatus as PlatformAccountStatus,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      banSource:
        typeof body.banSource === "string" ? body.banSource : undefined,
    });

    return NextResponse.json({ account });
  } catch (error) {
    return jsonServiceError(error);
  }
}
