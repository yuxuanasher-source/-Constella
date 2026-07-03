import { NextResponse } from "next/server";

import { SupabaseAccountLibraryRepository } from "@/features/account-library/account-library-repository";
import {
  getAccountLibraryRouteContext,
  jsonServiceError,
} from "@/features/account-library/account-library-route-utils";
import { recordAccountLogin } from "@/features/account-library/account-security-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { sendNotification } from "@/lib/notify/notify";

// 登录日志：登记一次账号登录事件；非白名单设备自动判定为可疑并推送高风险告警
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
      deviceFingerprint?: unknown;
      deviceName?: unknown;
      ipAddress?: unknown;
      location?: unknown;
      loggedInAt?: unknown;
      note?: unknown;
    };

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
    const loginLog = await recordAccountLogin({
      repo: new SupabaseAccountLibraryRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      notify: (input) => sendNotification(supabase, input),
      actor: auth,
      accountId,
      input: {
        deviceFingerprint,
        deviceName: typeof body.deviceName === "string" ? body.deviceName : null,
        ipAddress: typeof body.ipAddress === "string" ? body.ipAddress : null,
        location: typeof body.location === "string" ? body.location : null,
        loggedInAt:
          typeof body.loggedInAt === "string" ? body.loggedInAt : undefined,
        note: typeof body.note === "string" ? body.note : null,
      },
    });

    return NextResponse.json({ loginLog }, { status: 201 });
  } catch (error) {
    return jsonServiceError(error);
  }
}
