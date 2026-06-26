import { NextResponse } from "next/server";

import { evaluateAutoReviewShadow } from "@/features/auto-review/auto-review-service";
import { withAuth } from "@/lib/http/route-handler";

const allowedRoles = new Set(["owner", "ops_manager", "operator_business"]);

export const POST = withAuth(async ({ supabase, auth, request }) => {
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
});
