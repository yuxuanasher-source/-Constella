import { NextResponse } from "next/server";

import { runBusinessAnalysisAgent } from "@/features/ai/business-analysis-agent";
import type { ProjectReviewInput } from "@/features/war-room/project-review-report";
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
        { error: "Only MCN staff can run AI project reviews" },
        { status: 403 },
      );
    }

    const input = (await request.json()) as ProjectReviewInput;
    const result = runBusinessAnalysisAgent(input);

    return NextResponse.json({
      report: result.report,
      agentOutput: result.output,
      validation: result.validation,
    });
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
