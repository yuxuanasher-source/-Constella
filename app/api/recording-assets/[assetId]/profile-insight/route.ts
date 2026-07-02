import { NextResponse } from "next/server";

import { confirmRecordingAiProfileInsight } from "@/features/recordings/recording-profile-insights";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

type RouteContext = {
  params: Promise<{ assetId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (
      auth.role !== "owner" &&
      auth.role !== "ops_manager" &&
      auth.role !== "operator_business"
    ) {
      return NextResponse.json(
        { error: "Only operations staff can confirm profile insights" },
        { status: 403 },
      );
    }

    const { assetId } = await context.params;
    const insight = await confirmRecordingAiProfileInsight({
      client: supabase,
      actor: auth,
      assetId,
    });

    return NextResponse.json({ insight }, { status: 201 });
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
