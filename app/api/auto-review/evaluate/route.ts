import { NextResponse } from "next/server";

import { evaluateAutoReviewShadow } from "@/features/auto-review/auto-review-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

const allowedRoles = new Set(["owner", "ops_manager", "operator_business"]);

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

    if (!allowedRoles.has(auth.role)) {
      return NextResponse.json(
        { error: "Only operations roles can evaluate auto review" },
        { status: 403 },
      );
    }

    const body = await request.json();
    if (!body?.report || !body?.rule) {
      return NextResponse.json(
        { error: "Missing report or rule snapshot" },
        { status: 400 },
      );
    }

    const result = await evaluateAutoReviewShadow({
      client: supabase,
      actor: auth,
      report: body.report,
      rule: body.rule,
    });

    return NextResponse.json({ result });
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
