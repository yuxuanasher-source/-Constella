import { NextResponse } from "next/server";

import { scanLiveOperationAnomalies } from "@/features/anomalies/anomaly-scanner";
import { withAuth } from "@/lib/http/route-handler";

const allowedRoles = new Set(["owner", "ops_manager", "operator_business"]);

export const POST = withAuth(async ({ supabase, auth }) => {
  if (!allowedRoles.has(auth.role)) {
    return NextResponse.json(
      { error: "Only operations roles can scan anomalies" },
      { status: 403 },
    );
  }

  const result = await scanLiveOperationAnomalies({
    client: supabase,
    actor: auth,
  });

  return NextResponse.json({ result });
});
