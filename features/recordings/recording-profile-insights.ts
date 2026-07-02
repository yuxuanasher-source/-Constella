import type { SupabaseClient } from "@supabase/supabase-js";

import type { AiActor } from "@/features/ai/contracts";
import type { AppRole } from "@/lib/rbac/roles";

import {
  toRecordingAiAnalysisDto,
  type RecordingAiAnalysisRow,
} from "./recording-ai-analysis";

type RecordingProfileInsightAssetRow = {
  id: string;
  organization_id: string;
  streamer_id: string | null;
  project_id: string | null;
  application_id: string | null;
  title: string | null;
};

type RecordingProfileInsightAnalysisRow = RecordingAiAnalysisRow & {
  organization_id: string;
  recording_assets?: RecordingProfileInsightAssetRow | RecordingProfileInsightAssetRow[] | null;
};

export type StreamerProfileInsightDto = {
  id: string;
  streamerId: string;
  sourceRef: string;
  title: string;
  summary: string;
  strengths: string[];
  risks: string[];
  recommendations: string[];
  tags: string[];
  confirmedAt: string;
  createdAt: string;
};

type StreamerProfileInsightRow = {
  id: string;
  streamer_id: string;
  source_ref: string;
  title: string;
  summary: string | null;
  strengths: string[] | null;
  risks: string[] | null;
  recommendations: string[] | null;
  tags: string[] | null;
  confirmed_at: string;
  created_at: string;
};

const analysisWithAssetSelect = [
  "id",
  "organization_id",
  "asset_id",
  "status",
  "provider_name",
  "summary",
  "scorecard",
  "dimensions",
  "risk_flags",
  "recommendations",
  "error_summary",
  "ai_invocation_id",
  "created_at",
  "updated_at",
  "completed_at",
  "recording_ai_segments(id, segment_kind, start_seconds, end_seconds, title, summary, risk_level, evidence, sort_order)",
  "recording_assets(id, organization_id, streamer_id, project_id, application_id, title)",
].join(", ");

const insightSelect = [
  "id",
  "streamer_id",
  "source_ref",
  "title",
  "summary",
  "strengths",
  "risks",
  "recommendations",
  "tags",
  "confirmed_at",
  "created_at",
].join(", ");

export async function confirmRecordingAiProfileInsight({
  client,
  actor,
  assetId,
}: {
  client: SupabaseClient;
  actor: AiActor;
  assetId: string;
}): Promise<StreamerProfileInsightDto> {
  if (!canConfirmProfileInsight(actor.role)) {
    throw new Error("Only operations staff can confirm profile insights");
  }

  const normalizedAssetId = assetId.trim();
  if (!normalizedAssetId) {
    throw new Error("Recording asset id is required");
  }

  const { data, error } = await client
    .from("recording_ai_analyses")
    .select(analysisWithAssetSelect)
    .eq("asset_id", normalizedAssetId)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<RecordingProfileInsightAnalysisRow>();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Completed recording AI analysis not found");
  }

  const asset = first(data.recording_assets);
  if (!asset || asset.organization_id !== actor.organizationId) {
    throw new Error("Recording asset is outside current organization");
  }
  if (!asset.streamer_id) {
    throw new Error("Recording asset is not linked to a streamer profile");
  }

  const analysis = toRecordingAiAnalysisDto(data);
  const payload = profileInsightPayload({
    actor,
    analysis,
    asset,
  });

  const { data: insight, error: insightError } = await client
    .from("streamer_profile_insights")
    .upsert(payload, {
      onConflict: "organization_id,source_type,source_ref",
    })
    .select(insightSelect)
    .single<StreamerProfileInsightRow>();

  if (insightError) {
    throw insightError;
  }

  return toStreamerProfileInsightDto(insight);
}

function profileInsightPayload({
  actor,
  analysis,
  asset,
}: {
  actor: AiActor;
  analysis: ReturnType<typeof toRecordingAiAnalysisDto>;
  asset: RecordingProfileInsightAssetRow;
}) {
  const strengths = analysis.dimensions
    .filter((dimension) => dimension.score >= 75)
    .map(
      (dimension) =>
        `${dimension.label} ${dimension.score}：${dimension.finding}`,
    );
  const dimensionRisks = analysis.dimensions
    .filter((dimension) => dimension.score < 60)
    .map(
      (dimension) =>
        `${dimension.label} ${dimension.score}：${dimension.finding}`,
    );
  const recommendations = analysis.recommendations
    .map((item) => [item.title, item.detail].filter(Boolean).join(" - "))
    .filter(Boolean);
  const tags = normalizeTags([
    "recording_ai",
    "confirmed",
    ...analysis.dimensions.map((dimension) => dimension.label),
    ...analysis.riskFlags,
  ]);

  return {
    organization_id: actor.organizationId,
    streamer_id: asset.streamer_id,
    project_id: asset.project_id,
    recording_asset_id: asset.id,
    recording_ai_analysis_id: analysis.id,
    source_type: "recording_ai_analysis",
    source_ref: `recording_ai_analyses:${analysis.id}`,
    title: `录屏 AI 观察 · ${asset.title || "未命名录屏"}`,
    summary: analysis.summary,
    strengths,
    risks: [...analysis.riskFlags, ...dimensionRisks],
    recommendations,
    dimensions: analysis.dimensions,
    tags,
    created_by: actor.userId,
  };
}

function canConfirmProfileInsight(role: AppRole): boolean {
  return (
    role === "owner" ||
    role === "ops_manager" ||
    role === "operator_business"
  );
}

function normalizeTags(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(
    0,
    24,
  );
}

function toStreamerProfileInsightDto(
  row: StreamerProfileInsightRow,
): StreamerProfileInsightDto {
  return {
    id: row.id,
    streamerId: row.streamer_id,
    sourceRef: row.source_ref,
    title: row.title,
    summary: row.summary ?? "",
    strengths: row.strengths ?? [],
    risks: row.risks ?? [],
    recommendations: row.recommendations ?? [],
    tags: row.tags ?? [],
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
  };
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}
