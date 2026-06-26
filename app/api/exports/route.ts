import { NextResponse } from "next/server";

import {
  createGovernedExport,
  type GovernedExportResult,
} from "@/features/exports/export-service";
import { isExportKind } from "@/features/exports/export-definitions";
import { withAuth } from "@/lib/http/route-handler";
import { isMcnStaff } from "@/lib/rbac/roles";

export const POST = withAuth(async ({ supabase, auth, request }) => {
  if (!isMcnStaff(auth.role)) {
    return NextResponse.json(
      { error: "Only MCN staff can create exports" },
      { status: 403 },
    );
  }

  const body = await request.json();
  if (!isExportKind(body?.kind)) {
    return NextResponse.json({ error: "Invalid export kind" }, { status: 400 });
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
});
