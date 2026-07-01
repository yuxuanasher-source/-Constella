import { NextResponse } from "next/server";

import { requestRecordingAiAnalysis } from "@/features/recordings/recording-ai-analysis";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

type RouteContext = {
  params: Promise<{ assetId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
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
        { error: "Only MCN staff can start recording AI analysis" },
        { status: 403 },
      );
    }

    const { assetId } = await context.params;
    const analysis = await requestRecordingAiAnalysis({
      client: supabase,
      actor: auth,
      assetId,
    });

    return NextResponse.json({ analysis }, { status: 202 });
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
