import { NextResponse } from "next/server";

import { SupabaseAccountLibraryRepository } from "@/features/account-library/account-library-repository";
import {
  getAccountLibraryRouteContext,
  jsonServiceError,
} from "@/features/account-library/account-library-route-utils";
import { addAccountDevice } from "@/features/account-library/account-security-service";
import { writeAuditLog } from "@/lib/audit/audit";

// 登录设备白名单：新增设备
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
      deviceName?: unknown;
      deviceFingerprint?: unknown;
      note?: unknown;
    };

    const deviceName =
      typeof body.deviceName === "string" ? body.deviceName.trim() : "";
    if (!deviceName) {
      return NextResponse.json(
        { error: "deviceName is required" },
        { status: 400 },
      );
    }
    const deviceFingerprint =
      typeof body.deviceFingerprint === "string"
        ? body.deviceFingerprint.trim()
        : "";
    if (!deviceFingerprint) {
      return NextResponse.json(
        { error: "deviceFingerprint is required" },
        { status: 400 },
      );
    }

    const { accountId } = await params;
    const device = await addAccountDevice({
      repo: new SupabaseAccountLibraryRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor: auth,
      accountId,
      input: {
        deviceName,
        deviceFingerprint,
        note: typeof body.note === "string" ? body.note : null,
      },
    });

    return NextResponse.json({ device }, { status: 201 });
  } catch (error) {
    return jsonServiceError(error);
  }
}
