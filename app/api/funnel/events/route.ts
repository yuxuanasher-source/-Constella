import { NextResponse } from "next/server";

import {
  recordFunnelEvent,
  type FunnelEventName,
} from "@/features/funnel/funnel-events";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

// 客户端可上报的体验层事件（其余如 signup_completed 由服务端动作落，禁止前端伪造）
const CLIENT_EMITTABLE: FunnelEventName[] = [
  "landing_view",
  "pricing_view",
  "paywall_shown",
  "paywall_cta_clicked",
];

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isMcnStaff(auth.role)) {
      return NextResponse.json(
        { error: "Only MCN staff can record funnel events" },
        { status: 403 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const event = body.event;
    if (
      typeof event !== "string" ||
      !CLIENT_EMITTABLE.includes(event as FunnelEventName)
    ) {
      return NextResponse.json({ error: "Unsupported funnel event" }, { status: 400 });
    }

    await recordFunnelEvent(supabase, {
      event: event as FunnelEventName,
      organizationId: auth.organizationId,
      userId: auth.userId,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      properties:
        body.properties && typeof body.properties === "object"
          ? (body.properties as Record<string, unknown>)
          : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: statusForServiceError(error) },
      );
    }
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
