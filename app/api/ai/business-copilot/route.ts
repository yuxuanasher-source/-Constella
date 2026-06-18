import { NextResponse } from "next/server";

import { runAiToolQuery } from "@/features/ai/ai-tool-layer";
import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";
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
        { error: "Only MCN staff can run business copilot" },
        { status: 403 },
      );
    }

    const body = (await request.json()) as { question?: unknown };
    const question =
      typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return NextResponse.json(
        { error: "Business copilot question is required" },
        { status: 400 },
      );
    }

    const dashboard = await loadRoleHomeDashboard({ supabase, auth });
    const result = await runAiToolQuery({
      client: supabase,
      actor: {
        userId: auth.userId,
        name: auth.name,
        role: auth.role,
        organizationId: auth.organizationId,
      },
      toolName: "business_copilot_answer",
      input: { question, dashboard },
    });

    return NextResponse.json({
      result,
      dashboardProfile: dashboard.profile,
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
