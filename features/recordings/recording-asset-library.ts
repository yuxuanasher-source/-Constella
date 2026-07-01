import type { SupabaseClient } from "@supabase/supabase-js";

import { createSignedDownloadUrl } from "@/features/storage/private-upload";

import {
  toRecordingAiAnalysisDto,
  type RecordingAiAnalysisRow,
} from "./recording-ai-analysis";
import {
  toRecordingAssetDto,
  type RecordingAssetDto,
  type RecordingAssetKind,
  type RecordingAssetPreviewState,
  type RecordingAssetSourceKind,
  type RecordingReviewStatus,
} from "./recording-assets";

type RecordingAssetSourceRow = {
  id: string;
  source_kind: RecordingAssetSourceKind;
  preview_state: RecordingAssetPreviewState;
  provider: string;
  external_url: string | null;
  storage_path: string | null;
  submitted_at: string | null;
};

type RecordingAssetRow = {
  id: string;
  title: string;
  asset_kind: RecordingAssetKind;
  review_status: RecordingReviewStatus;
  preview_state: RecordingAssetPreviewState;
  duration_seconds: number | null;
  project_id: string | null;
  application_id: string | null;
  created_at: string;
  updated_at: string;
  recording_asset_sources?: RecordingAssetSourceRow[] | null;
  recording_ai_analyses?: RecordingAiAnalysisRow[] | null;
};

export async function listStreamerRecordingAssets(
  supabase: SupabaseClient | null,
  input: { organizationId: string; streamerId: string; bucket: string },
): Promise<RecordingAssetDto[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("recording_assets")
    .select(
      [
        "id",
        "title",
        "asset_kind",
        "review_status",
        "preview_state",
        "duration_seconds",
        "project_id",
        "application_id",
        "created_at",
        "updated_at",
        "recording_asset_sources(id, source_kind, preview_state, provider, external_url, storage_path, submitted_at)",
        "recording_ai_analyses(id, asset_id, status, provider_name, summary, scorecard, dimensions, risk_flags, recommendations, error_summary, ai_invocation_id, created_at, updated_at, completed_at, recording_ai_segments(id, segment_kind, start_seconds, end_seconds, title, summary, risk_level, evidence, sort_order))",
      ].join(", "),
    )
    .eq("organization_id", input.organizationId)
    .eq("streamer_id", input.streamerId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return Promise.all(
    ((data ?? []) as unknown as RecordingAssetRow[]).map((row) =>
      toRecordingAssetDtoFromRow(supabase, row, input.bucket),
    ),
  );
}

async function toRecordingAssetDtoFromRow(
  supabase: SupabaseClient,
  row: RecordingAssetRow,
  bucket: string,
): Promise<RecordingAssetDto> {
  const sources = await Promise.all(
    (row.recording_asset_sources ?? []).map(async (source) => ({
      id: source.id,
      sourceKind: source.source_kind,
      previewState: source.preview_state,
      provider: source.provider,
      externalUrl: source.external_url,
      storagePath: source.storage_path,
      submittedAt: source.submitted_at,
      downloadUrl: source.storage_path
        ? (
            await createSignedDownloadUrl({
              client: supabase,
              bucket,
              path: source.storage_path,
              expiresInSeconds: 3600,
            })
          ).signedUrl
        : null,
    })),
  );

  return toRecordingAssetDto({
    asset: {
      id: row.id,
      title: row.title,
      assetKind: row.asset_kind,
      reviewStatus: row.review_status,
      previewState: row.preview_state,
      durationSeconds: row.duration_seconds,
      projectId: row.project_id,
      applicationId: row.application_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    sources,
    aiAnalysis: latestAnalysis(row.recording_ai_analyses),
  });
}

function latestAnalysis(
  rows: RecordingAiAnalysisRow[] | null | undefined,
): RecordingAssetDto["aiAnalysis"] {
  const [row] = [...(rows ?? [])].sort((left, right) =>
    (right.created_at ?? "").localeCompare(left.created_at ?? ""),
  );
  return row ? toRecordingAiAnalysisDto(row) : null;
}
