import { NextResponse } from "next/server";

import {
  runCastingAdviceAgent,
  type CastingAdviceInput,
} from "@/features/ai/casting-advice-agent";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

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
        { error: "Only MCN staff can run AI casting briefs" },
        { status: 403 },
      );
    }

    const input = (await request.json()) as CastingAdviceInput;
    const result = runCastingAdviceAgent({
      project: input.project,
      candidates: Array.isArray(input.candidates) ? input.candidates : [],
      maxRecommendations: input.maxRecommendations,
    });

    return NextResponse.json(result);
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
