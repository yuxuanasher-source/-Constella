import { NextResponse } from "next/server";

import { aggregateFunnel } from "@/features/funnel/funnel-metrics";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET() {
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
        { error: "Only MCN staff can view funnel metrics" },
        { status: 403 },
      );
    }

    const { data, error } = await supabase
      .from("funnel_events")
      .select("event, reason")
      .eq("organization_id", auth.organizationId)
      .returns<{ event: string; reason: string | null }[]>();
    if (error) {
      throw error;
    }

    return NextResponse.json({ metrics: aggregateFunnel(data ?? []) });
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
