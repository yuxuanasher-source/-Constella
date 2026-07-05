import { NextResponse } from "next/server";

import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import {
  getLiveOperationsRouteContext,
  jsonError,
} from "@/features/live-operations/live-operations-route-utils";
import type { RecordingAssetSourceKind } from "@/features/recordings/recording-assets";
import { createSignedDownloadUrl } from "@/features/storage/private-upload";
import { getPrivateStorageBucket } from "@/lib/config/env";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

type AssetSourceRow = {
  source_kind: RecordingAssetSourceKind;
  external_url: string | null;
  storage_path: string | null;
  submitted_at: string | null;
};

type AssetRow = {
  id: string;
  organization_id: string;
  streamer_id: string;
  recording_asset_sources: AssetSourceRow[] | null;
};

// 与 toRecordingAssetDto 的主 source 选取逻辑保持一致：私有文件优先。
const sourcePriority: Record<RecordingAssetSourceKind, number> = {
  storage_object: 3,
  bilibili_url: 2,
  external_url: 1,
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await params;
    const context = await getLiveOperationsRouteContext();

    const admin = createSupabaseAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Storage client unavailable" },
        { status: 500 },
      );
    }

    // Resolve the asset with service role, then enforce organization
    // isolation manually (same pattern as the report screenshot endpoint).
    const { data, error } = await admin
      .from("recording_assets")
      .select(
        "id, organization_id, streamer_id, recording_asset_sources(source_kind, external_url, storage_path, submitted_at)",
      )
      .eq("id", assetId)
      .maybeSingle();
    if (error) {
      throw error;
    }

    const asset = data as AssetRow | null;
    if (!asset || asset.organization_id !== context.auth.organizationId) {
      return NextResponse.json(
        { error: "Recording asset not found" },
        { status: 404 },
      );
    }

    // 权限：同组织 MCN staff 放行；主播只能看自己的资产；其余 403。
    if (!isMcnStaff(context.auth.role)) {
      const streamerId =
        context.auth.role === "streamer"
          ? await getStreamerIdForUser(
              context.supabase,
              context.auth.userId,
              context.auth.organizationId,
            )
          : null;
      if (!streamerId || streamerId !== asset.streamer_id) {
        return NextResponse.json(
          { error: "You do not have access to this recording asset" },
          { status: 403 },
        );
      }
    }

    const primary = [...(asset.recording_asset_sources ?? [])].sort(
      (left, right) =>
        sourcePriority[right.source_kind] - sourcePriority[left.source_kind] ||
        (right.submitted_at ?? "").localeCompare(left.submitted_at ?? ""),
    )[0];

    const storagePath =
      primary?.source_kind === "storage_object"
        ? primary.storage_path?.trim() || null
        : null;
    if (!storagePath) {
      // 外链资产不走本端点，前端应直接打开 externalUrl。
      if (primary?.external_url) {
        return NextResponse.json(
          { error: "external link asset is not downloadable here" },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: "no downloadable source" },
        { status: 404 },
      );
    }

    const signed = await createSignedDownloadUrl({
      client: admin,
      bucket: getPrivateStorageBucket(),
      path: storagePath,
      expiresInSeconds: 3600,
    });

    // Redirect straight to the 1h signed URL so a plain <video src> or <a>
    // can follow it without any client-side fetch; no byte proxying here.
    return NextResponse.redirect(signed.signedUrl, 302);
  } catch (error) {
    return jsonError(error);
  }
}
