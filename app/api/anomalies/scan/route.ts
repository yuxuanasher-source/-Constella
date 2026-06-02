import { NextResponse } from "next/server";

import { scanLiveOperationAnomalies } from "@/features/anomalies/anomaly-scanner";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

const allowedRoles = new Set(["owner", "ops_manager", "operator_business"]);

export async function POST(_request?: Request) {
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
        { error: "Only operations roles can scan anomalies" },
        { status: 403 },
      );
    }

    const result = await scanLiveOperationAnomalies({
      client: supabase,
      actor: auth,
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
