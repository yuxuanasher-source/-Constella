import { NextResponse } from "next/server";

import {
  buildReportSettlementXlsx,
  screenshotExtensionFromPath,
  type ReportScreenshot,
} from "@/features/exports/report-settlement-xlsx";
import { buildReportSettlementExportRows } from "@/features/exports/settlement-export-data";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { getServerEnv } from "@/lib/config/env";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

// 单次导出最多嵌入的截图数量，避免文件过大 / 下载过久。
const MAX_EMBEDDED_SCREENSHOTS = 200;

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
    const requestedReportIds = reportIdsFromBody(body);
    const rows = await buildReportSettlementExportRows({
      client: supabase,
      organizationId: auth.organizationId,
      organizationName: auth.organizationName,
      reportIds: requestedReportIds,
      projectId: optionalString(body?.projectId),
      periodStart: optionalString(body?.periodStart),
      periodEnd: optionalString(body?.periodEnd),
    });

    const exportedReportIds = Array.from(
      new Set(
        rows
          .map((row) => row?.reportId)
          .filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0,
          ),
      ),
    );

    const screenshotByReportId = new Map<string, ReportScreenshot>();

    if (exportedReportIds.length > 0) {
      const { data: shots } = await supabase
        .from("report_screenshots")
        .select("live_report_id, storage_path, uploaded_at")
        .in("live_report_id", exportedReportIds)
        .order("uploaded_at", { ascending: false });

      const pathByReport = new Map<string, string>();
      for (const shot of (shots ?? []) as Array<{
        live_report_id: string;
        storage_path: string;
      }>) {
        if (!pathByReport.has(shot.live_report_id)) {
          pathByReport.set(shot.live_report_id, shot.storage_path);
        }
      }

      const downloader = createSupabaseAdminClient() ?? supabase;
      const bucket = getServerEnv().STORAGE_BUCKET_PRIVATE;
      let embedded = 0;
      for (const [reportId, path] of pathByReport) {
        if (embedded >= MAX_EMBEDDED_SCREENSHOTS) break;
        try {
          const { data } = await downloader.storage.from(bucket).download(path);
          if (!data) continue;
          const buffer = Buffer.from(await data.arrayBuffer());
          screenshotByReportId.set(reportId, {
            buffer,
            extension: screenshotExtensionFromPath(path),
          });
          embedded += 1;
        } catch {
          // 单张截图下载失败不阻断整体导出。
        }
      }
    }

    const xlsx = await buildReportSettlementXlsx({
      role: auth.role,
      rows,
      screenshotByReportId,
    });
    const filename = `report_settlement_details-${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;

    await writeAuditLog(supabase, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      actorName: auth.name,
      actorRole: auth.role,
      action: "export",
      module: "export",
      objectType: "export_job",
      objectName: filename,
      after: {
        kind: "report_settlement_details_xlsx",
        rowCount: rows.length,
        screenshotCount: screenshotByReportId.size,
        parameters: {
          reportIds: requestedReportIds,
          projectId: optionalString(body?.projectId),
          periodStart: optionalString(body?.periodStart),
          periodEnd: optionalString(body?.periodEnd),
        },
      },
      changedFields: ["export_kind", "row_count", "export_parameters"],
    });

    return NextResponse.json({
      export: { filename, base64: xlsx.toString("base64") },
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

function reportIdsFromBody(body: unknown): string[] {
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const explicit = stringArray(record.reportIds);
  if (explicit.length > 0) {
    return explicit;
  }
  if (!Array.isArray(record.rows)) {
    return [];
  }
  return stringArray(
    record.rows.map((row) =>
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
