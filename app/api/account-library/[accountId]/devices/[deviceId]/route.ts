import { NextResponse } from "next/server";

import { SupabaseAccountLibraryRepository } from "@/features/account-library/account-library-repository";
import {
  getAccountLibraryRouteContext,
  jsonServiceError,
} from "@/features/account-library/account-library-route-utils";
import { revokeAccountDevice } from "@/features/account-library/account-security-service";
import { writeAuditLog } from "@/lib/audit/audit";

// 登录设备白名单：撤销设备
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string; deviceId: string }> },
) {
  try {
    const context = await getAccountLibraryRouteContext();
    if (context instanceof NextResponse) {
      return context;
    }
    const { supabase, auth } = context;

    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      reason?: unknown;
    };
    if (body.action !== "revoke") {
      return NextResponse.json(
        { error: "action must be 'revoke'" },
        { status: 400 },
      );
    }

    const { accountId, deviceId } = await params;
    const device = await revokeAccountDevice({
      repo: new SupabaseAccountLibraryRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor: auth,
      accountId,
      deviceId,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });

    return NextResponse.json({ device });
  } catch (error) {
    return jsonServiceError(error);
  }
}
