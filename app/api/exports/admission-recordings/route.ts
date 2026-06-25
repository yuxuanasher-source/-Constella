import { NextResponse } from "next/server";

import {
  listAdmissionProjectRecordings,
  toAdmissionRecordingExportRows,
} from "@/features/applications/admission-board";
import {
  createGovernedExport,
  type GovernedExportResult,
} from "@/features/exports/export-service";
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
        { error: "Only MCN staff can export admission recordings" },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const projectId =
      typeof body.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required" },
        { status: 400 },
      );
    }

    const details = await listAdmissionProjectRecordings(supabase, projectId);
    const rows = toAdmissionRecordingExportRows(details);
    const result: GovernedExportResult = await createGovernedExport({
      client: supabase,
      actor: auth,
      kind: "admission_recordings",
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
