import { NextResponse } from "next/server";

import {
  createGovernedExport,
  type GovernedExportResult,
} from "@/features/exports/export-service";
import {
  buildReportSettlementExportRows,
  buildSettlementBatchExportRows,
} from "@/features/exports/settlement-export-data";
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

    const parameters = exportParameters(body);
    const rows = await resolveExportRows({
      client: supabase,
      auth,
      body,
    });
    const result: GovernedExportResult = await createGovernedExport({
      client: supabase,
      actor: auth,
      kind: body.kind,
      rows,
      ...(parameters ? { parameters } : {}),
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

async function resolveExportRows({
  client,
  auth,
  body,
}: {
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  auth: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>;
  body: Record<string, unknown>;
}) {
  if (!client) {
    return [];
  }
  if (body.kind === "settlement_batch") {
    return buildSettlementBatchExportRows({
      client,
      organizationId: auth.organizationId,
      batchIds: stringArray(body.batchIds),
      periodStart: optionalString(body.periodStart),
      periodEnd: optionalString(body.periodEnd),
    });
  }
  if (body.kind === "report_settlement_details") {
    return buildReportSettlementExportRows({
      client,
      organizationId: auth.organizationId,
      organizationName: auth.organizationName,
      reportIds: reportIdsFromBody(body),
      projectId: optionalString(body.projectId),
      periodStart: optionalString(body.periodStart),
      periodEnd: optionalString(body.periodEnd),
    });
  }
  return Array.isArray(body.rows)
    ? (body.rows as Array<Record<string, unknown>>)
    : [];
}

function exportParameters(
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  if (body.kind === "settlement_batch") {
    return {
      batchIds: stringArray(body.batchIds),
      periodStart: optionalString(body.periodStart),
      periodEnd: optionalString(body.periodEnd),
    };
  }
  if (body.kind === "report_settlement_details") {
    return {
      reportIds: reportIdsFromBody(body),
      projectId: optionalString(body.projectId),
      periodStart: optionalString(body.periodStart),
      periodEnd: optionalString(body.periodEnd),
    };
  }
  return null;
}

function reportIdsFromBody(body: Record<string, unknown>): string[] {
  const explicit = stringArray(body.reportIds);
  if (explicit.length > 0) {
    return explicit;
  }
  if (!Array.isArray(body.rows)) {
    return [];
  }
  return stringArray(
    body.rows.map((row) =>
      row && typeof row === "object"
        ? (row as Record<string, unknown>).reportId
        : null,
    ),
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean),
        ),
      )
    : [];
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
