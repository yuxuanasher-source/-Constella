import { NextResponse } from "next/server";

import {
  createGovernedExport,
  type GovernedExportResult,
} from "@/features/exports/export-service";
import { isExportKind } from "@/features/exports/export-definitions";
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
        { error: "Only MCN staff can create exports" },
        { status: 403 },
      );
    }

    const body = await request.json();
    if (!isExportKind(body?.kind)) {
      return NextResponse.json(
        { error: "Invalid export kind" },
        { status: 400 },
      );
    }

    const rows = Array.isArray(body.rows)
      ? (body.rows as Array<Record<string, unknown>>)
      : [];
    const result: GovernedExportResult = await createGovernedExport({
      client: supabase,
      actor: auth,
      kind: body.kind,
      rows,
    });

    return NextResponse.json({ export: result });
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
