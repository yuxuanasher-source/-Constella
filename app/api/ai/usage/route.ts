import { NextResponse } from "next/server";

import { getAiUsageOverview } from "@/features/ai/ai-usage-overview";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET(request: Request) {
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
        { error: "Only MCN staff can view AI usage" },
        { status: 403 },
      );
    }

    const rangeDays = parseRangeDays(
      new URL(request.url).searchParams.get("rangeDays"),
    );

    const usage = await getAiUsageOverview({
      client: supabase,
      organizationId: auth.organizationId,
      rangeDays,
    });

    return NextResponse.json({ usage });
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

function parseRangeDays(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return 30;
  }
  return Math.min(365, Math.max(1, parsed));
}
