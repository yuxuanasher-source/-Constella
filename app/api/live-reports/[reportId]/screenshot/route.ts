import { NextResponse } from "next/server";

import {
  getLiveOperationsRouteContext,
  jsonError,
} from "@/features/live-operations/live-operations-route-utils";
import { createSignedDownloadUrl } from "@/features/storage/private-upload";
import { getPrivateStorageBucket } from "@/lib/config/env";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

type ReportScreenshotRow = {
  storage_path: string;
  metadata: Record<string, unknown> | null;
  organization_id: string;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  try {
    const { reportId } = await params;
    const context = await getLiveOperationsRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      return NextResponse.json(
        { error: "Only MCN staff can view report screenshots" },
        { status: 403 },
      );
    }

    const admin = createSupabaseAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Storage client unavailable" },
        { status: 500 },
      );
    }

    // Look up the most recent screenshot for this report, then enforce
    // organization isolation before producing a signed URL.
    const { data, error } = await admin
      .from("report_screenshots")
      .select("storage_path, metadata, organization_id")
      .eq("live_report_id", reportId)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }

    const row = data as ReportScreenshotRow | null;
    if (!row || row.organization_id !== context.auth.organizationId) {
      return NextResponse.json(
        { error: "Screenshot not found" },
        { status: 404 },
      );
    }

    const metadataBucket = row.metadata?.imageBucket;
    const bucket =
      typeof metadataBucket === "string" && metadataBucket
        ? metadataBucket
        : getPrivateStorageBucket();

    const signed = await createSignedDownloadUrl({
      client: admin,
      bucket,
      path: row.storage_path,
      expiresInSeconds: 3600,
    });

    // Redirect straight to the signed URL so a plain <img src> can load the
    // screenshot without any client-side fetch.
    return NextResponse.redirect(signed.signedUrl, 302);
  } catch (error) {
    return jsonError(error);
  }
}
