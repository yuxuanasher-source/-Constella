import { NextResponse } from "next/server";

import { SupabaseSettlementLineRepository } from "@/features/settlements/settlement-line-repository";
import { getSettlementBreakdown } from "@/features/settlements/settlement-line-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { batchId } = await params;
    const breakdown = await getSettlementBreakdown({
      repo: new SupabaseSettlementLineRepository(supabase),
      actor: auth,
      batchId,
    });

    return NextResponse.json({ breakdown });
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
