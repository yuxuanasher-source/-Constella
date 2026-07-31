import {
  createAiInvocationId,
  recordAiInvocation,
} from "@/features/ai/invocation-ledger";
import type { AiActor, AiExecutionActor } from "@/features/ai/contracts";

import type {
  RecordingAiPipelineStage,
  RecordingAiDraftPipeline,
  RecordingAiPipelineResult,
} from "./recording-ai-pipeline";
import {
  toRecordingAssetDto,
  type RecordingAssetDto,
  type RecordingAssetKind,
  type RecordingAssetPreviewState,
  type RecordingAssetSourceKind,
  type RecordingReviewStatus,
} from "./recording-assets";

export type RecordingAiAnalysisStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type RecordingAiDimensionKey =
  | "rhythm"
  | "script"
  | "interaction"
  | "media_quality"
  | "compliance"
  | "project_match";

export type RecordingAiDimension = {
  key: RecordingAiDimensionKey;
  label: string;
  score: number;
  finding: string;
};

export type RecordingAiRecommendation = {
  title: string;
  detail: string;
  requiresHumanApproval: true;
};

export type RecordingAiSegmentDto = {
  id: string;
  segmentKind: string;
  startSeconds: number;
  endSeconds: number;
  timeRangeLabel: string;
  title: string;
  summary: string;
  riskLevel: "low" | "medium" | "high";
  evidence: Record<string, unknown>;
  sortOrder: number;
};

export type RecordingAiAnalysisDto = {
  id: string;
  assetId: string;
  status: RecordingAiAnalysisStatus;
  statusLabel: string;
  providerName: string | null;
  summary: string;
  scorecard: Partial<Record<RecordingAiDimensionKey, number>>;
  dimensions: RecordingAiDimension[];
  riskFlags: string[];
  recommendations: RecordingAiRecommendation[];
  segments: RecordingAiSegmentDto[];
  transcriptText: string | null;
  asrProvider: string | null;
  errorSummary: string | null;
  aiInvocationId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type RecordingAiAnalysisDraft = {
  summary: string;
  reviewBoundary: string;
  scorecard: Record<RecordingAiDimensionKey, number>;
  dimensions: RecordingAiDimension[];
  riskFlags: string[];
  recommendations: RecordingAiRecommendation[];
  segments: Array<{
    segmentKind: string;
    startSeconds: number;
    endSeconds: number;
    title: string;
    summary: string;
    riskLevel: "low" | "medium" | "high";
    evidence: Record<string, unknown>;
    sortOrder: number;
  }>;
};

export type RecordingAiAnalysisRow = {
  id: string;
  asset_id: string;
  status: RecordingAiAnalysisStatus;
  provider_name: string | null;
  summary: string | null;
  scorecard: unknown;
  dimensions: unknown;
  risk_flags: unknown;
  recommendations: unknown;
  transcript_text?: string | null;
  asr_provider?: string | null;
  error_summary: string | null;
  ai_invocation_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  recording_ai_segments?: RecordingAiSegmentRow[] | null;
};

export type RecordingAiSegmentRow = {
  id: string;
  segment_kind: string;
  start_seconds: number;
  end_seconds: number;
  title: string;
  summary: string;
  risk_level: "low" | "medium" | "high";
  evidence: Record<string, unknown> | null;
  sort_order: number;
};

type RecordingAiClient = Parameters<typeof recordAiInvocation>[0]["client"] & {
  from(table: string): {
    insert(payload: Record<string, unknown>): {
      select(columns: string): {
        single(): PromiseLike<{
          data: RecordingAiAnalysisRow | null;
          error: Error | null;
        }>;
      };
    };
  };
};

type RecordingAiCandidateListChain = {
  order(
    column: string,
    options: { ascending: boolean },
  ): {
    limit(count: number): PromiseLike<{
      data: RecordingAiClaimCandidateRow[] | null;
      error: Error | null;
    }>;
  };
};

type RecordingAiClaimResultChain = {
  select(columns: string): {
    maybeSingle(): PromiseLike<{
      data: RecordingAiWorkItemRow | null;
      error: Error | null;
    }>;
  };
};

type RecordingAiRunnerDb = {
  from(table: "recording_ai_analyses"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        single(): PromiseLike<{
          data: RecordingAiWorkItemRow | null;
          error: Error | null;
        }>;
        eq(
          column: string,
          value: string,
        ): RecordingAiCandidateListChain & {
          lt(column: string, value: string): RecordingAiCandidateListChain;
        };
      };
    };
    update(payload: Record<string, unknown>): {
      eq(
        column: string,
        value: string,
      ): {
        select(columns: string): {
          single(): PromiseLike<{
            data: RecordingAiWorkItemRow | null;
            error: Error | null;
          }>;
        };
        eq(
          column: string,
          value: string,
        ): RecordingAiClaimResultChain & {
          lt(column: string, value: string): RecordingAiClaimResultChain;
        };
      };
    };
  };
  from(table: "recording_ai_segments"): {
    insert(
      payload: Record<string, unknown>[],
    ): PromiseLike<{ error: Error | null }>;
  };
};

type RecordingAiClaimCandidateRow = {
  id: string;
  attempt: number | null;
  max_attempts: number | null;
  created_at: string;
};

type RecordingAiWorkItemRow = RecordingAiAnalysisRow & {
  organization_id: string;
  attempt: number;
  max_attempts: number;
  stage?: string | null;
  claimed_by?: string | null;
  claimed_at?: string | null;
  lease_expires_at?: string | null;
  cancel_requested_at?: string | null;
  recording_assets?: RecordingAssetWorkItemRow | null;
};

type RecordingAssetSourceWorkItemRow = {
  id: string;
  source_kind: RecordingAssetSourceKind;
  preview_state: RecordingAssetPreviewState;
  provider: string;
  external_url: string | null;
  storage_path: string | null;
  submitted_at: string | null;
};

type RecordingAssetWorkItemRow = {
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
  recording_asset_sources?: RecordingAssetSourceWorkItemRow[] | null;
};

const statusLabels: Record<RecordingAiAnalysisStatus, string> = {
  queued: "排队中",
  running: "分析中",
  succeeded: "已完成",
  failed: "分析失败",
  cancelled: "已取消",
};

export const recordingAiAnalysisSelect = [
  "id",
  "asset_id",
  "status",
  "provider_name",
  "summary",
  "scorecard",
  "dimensions",
  "risk_flags",
  "recommendations",
  "transcript_text",
  "asr_provider",
  "error_summary",
  "ai_invocation_id",
  "created_at",
  "updated_at",
  "completed_at",
  "recording_ai_segments(id, segment_kind, start_seconds, end_seconds, title, summary, risk_level, evidence, sort_order)",
].join(", ");

// 列表/队列用轻量 select：去掉 transcript_text（长文本，UI 列表与详情
// 面板都不渲染；admission pre-review 走自己的查询拿 transcript）。
// segments 保留——详情面板要用。
export const recordingAiAnalysisListSelect = [
  "id",
  "asset_id",
  "status",
  "provider_name",
  "summary",
  "scorecard",
  "dimensions",
  "risk_flags",
  "recommendations",
  "asr_provider",
  "error_summary",
  "ai_invocation_id",
  "created_at",
  "updated_at",
  "completed_at",
  "recording_ai_segments(id, segment_kind, start_seconds, end_seconds, title, summary, risk_level, evidence, sort_order)",
].join(", ");

const analysisWorkItemSelect = [
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
  "transcript_text",
  "asr_provider",
  "attempt",
  "max_attempts",
  "cancel_requested_at",
  "error_summary",
  "ai_invocation_id",
  "created_at",
  "updated_at",
  "completed_at",
  "recording_ai_segments(id, segment_kind, start_seconds, end_seconds, title, summary, risk_level, evidence, sort_order)",
  "recording_assets(id, title, asset_kind, review_status, preview_state, duration_seconds, project_id, application_id, created_at, updated_at, recording_asset_sources(id, source_kind, preview_state, provider, external_url, storage_path, submitted_at))",
].join(", ");

export function buildRecordingAiAnalysisDraft({
  asset,
}: {
  asset: RecordingAssetDto;
}): RecordingAiAnalysisDraft {
  const source = asset.primarySource;
  const sourceLabel =
    source?.previewMode === "private_file" ||
    source?.sourceKind === "storage_object"
      ? "原始文件"
      : source?.previewMode === "embed"
        ? "B 站预览链接"
        : source?.previewMode === "external"
          ? "外部录屏链接"
          : "待确认来源";
  const duration = Math.max(0, Math.trunc(asset.durationSeconds ?? 0));
  const hasProject = Boolean(asset.projectId);
  const hasPrivateFile =
    source?.previewMode === "private_file" ||
    source?.sourceKind === "storage_object";
  const isRejected = asset.reviewStatus === "rejected";

  const scorecard = {
    rhythm: duration >= 1200 ? 82 : duration > 0 ? 72 : 60,
    script: hasProject ? 78 : 68,
    interaction: duration >= 900 ? 76 : 66,
    media_quality: hasPrivateFile
      ? 84
      : source?.previewMode === "embed"
        ? 76
        : 68,
    compliance: isRejected ? 42 : 74,
    project_match: hasProject ? 80 : 66,
  };

  const dimensions: RecordingAiDimension[] = [
    {
      key: "rhythm",
      label: "直播节奏",
      score: scorecard.rhythm,
      finding:
        duration > 0
          ? "可按开场、互动和风险片段拆解复核。"
          : "缺少时长信息，需审核员结合原片确认节奏。",
    },
    {
      key: "script",
      label: "话术结构",
      score: scorecard.script,
      finding: hasProject
        ? "已关联项目，可按项目卖点检查话术匹配。"
        : "未关联项目，仅能沉淀为主播通用素材。",
    },
    {
      key: "interaction",
      label: "互动设计",
      score: scorecard.interaction,
      finding: "建议重点复核中段互动密度和引导动作。",
    },
    {
      key: "media_quality",
      label: "音画质量",
      score: scorecard.media_quality,
      finding: hasPrivateFile
        ? "原始文件可作为正式审核证据。"
        : "外部预览可能受平台限制，必要时要求补传原始文件。",
    },
    {
      key: "compliance",
      label: "合规风险",
      score: scorecard.compliance,
      finding: isRejected
        ? "当前录屏已有驳回状态，需优先复核风险原因。"
        : "未发现系统态高危结论，但仍需人工确认敏感片段。",
    },
    {
      key: "project_match",
      label: "项目匹配",
      score: scorecard.project_match,
      finding: hasProject
        ? "可进入项目准入和复盘辅助判断。"
        : "可进入主播画像，但不能直接用于项目准入结论。",
    },
  ];

  return {
    summary: `已基于${sourceLabel}生成录屏 AI 分析草稿，建议审核员结合原片确认节奏、互动、音画质量与合规风险。`,
    reviewBoundary:
      "AI 分析仅作为审核辅助，不自动通过、不自动拒绝，也不自动修改主播画像；关键结论必须由人工审核确认。",
    scorecard,
    dimensions,
    riskFlags: [
      hasPrivateFile
        ? "原始文件可追溯，但高风险片段仍需人工复核。"
        : "外部链接可能失效或无法预览，建议补充原始文件。",
    ],
    recommendations: [
      {
        title: "人工复核高光片段",
        detail: "确认开场、互动和风险片段后，再沉淀到主播画像或项目复盘。",
        requiresHumanApproval: true,
      },
      {
        title: "补齐项目匹配标签",
        detail: hasProject
          ? "将项目卖点、平台和主播表现关联到准入判断。"
          : "先补充产品、平台和内容标签，避免泛化评价。",
        requiresHumanApproval: true,
      },
    ],
    segments: buildSegments(asset),
  };
}

export function toRecordingAiAnalysisDto(
  row: RecordingAiAnalysisRow,
): RecordingAiAnalysisDto {
  return {
    id: row.id,
    assetId: row.asset_id,
    status: row.status,
    statusLabel: statusLabels[row.status] ?? row.status,
    providerName: row.provider_name ?? null,
    summary: row.summary ?? "",
    scorecard: normalizeScorecard(row.scorecard),
    dimensions: normalizeDimensions(row.dimensions),
    riskFlags: normalizeStringArray(row.risk_flags),
    recommendations: normalizeRecommendations(row.recommendations),
    segments: (row.recording_ai_segments ?? [])
      .map(toSegmentDto)
      .sort((left, right) => left.sortOrder - right.sortOrder),
    transcriptText: row.transcript_text ?? null,
    asrProvider: row.asr_provider ?? null,
    errorSummary: row.error_summary ?? null,
    aiInvocationId: row.ai_invocation_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
  };
}

export async function requestRecordingAiAnalysis({
  client,
  actor,
  assetId,
}: {
  client: RecordingAiClient;
  actor: AiExecutionActor;
  assetId: string;
}): Promise<RecordingAiAnalysisDto> {
  const normalizedAssetId = assetId.trim();
  if (!normalizedAssetId) {
    throw new Error("Recording asset id is required");
  }

  const invocationId = createAiInvocationId();
  await recordAiInvocation({
    client,
    actor,
    input: {
      id: invocationId,
      scene: "recording.analyze_asset",
      objectType: "recording_asset",
      objectId: normalizedAssetId,
      providerName: "deterministic",
      status: "queued",
      metadata: { boundary: "human_review_required" },
    },
  });

  const { data, error } = await client
    .from("recording_ai_analyses")
    .insert({
      organization_id: actor.organizationId,
      asset_id: normalizedAssetId,
      status: "queued",
      provider_name: "deterministic",
      ai_invocation_id: invocationId,
      requested_by: actor.userId,
      summary: "",
      scorecard: {},
      dimensions: [],
      risk_flags: [],
      recommendations: [],
      attempt: 0,
      max_attempts: 3,
    })
    .select(recordingAiAnalysisSelect)
    .single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Failed to create recording AI analysis");
  }

  return toRecordingAiAnalysisDto(data);
}

export async function runRecordingAiAnalysisOnce({
  client,
  actor,
  analysisId,
  now = () => new Date(),
  draftBuilder = buildRecordingAiAnalysisDraft,
  pipeline = null,
}: {
  client: Parameters<typeof recordAiInvocation>[0]["client"];
  actor: AiActor;
  analysisId: string;
  now?: () => Date;
  draftBuilder?: typeof buildRecordingAiAnalysisDraft;
  pipeline?: RecordingAiDraftPipeline | null;
}): Promise<RecordingAiAnalysisDto> {
  const normalizedAnalysisId = analysisId.trim();
  if (!normalizedAnalysisId) {
    throw new Error("Recording analysis id is required");
  }

  const db = client as unknown as RecordingAiRunnerDb;
  const workItem = await loadRecordingAiWorkItem(db, normalizedAnalysisId);
  if (workItem.organization_id !== actor.organizationId) {
    throw new Error("Recording AI analysis belongs to another organization");
  }
  if (workItem.cancel_requested_at) {
    throw new Error("Recording AI analysis was cancelled");
  }

  if (workItem.status !== "queued") {
    throw new Error(`Recording AI analysis is not queued: ${workItem.status}`);
  }

  const attempt = Math.max(0, Math.trunc(workItem.attempt ?? 0)) + 1;
  const claimed = await claimQueuedRecordingAiAnalysis(
    db,
    normalizedAnalysisId,
    attempt,
    now().toISOString(),
  );
  if (!claimed) {
    throw new Error(
      "Recording AI analysis is not queued: claimed by another runner",
    );
  }

  return executeClaimedRecordingAiAnalysis({
    client: client as unknown as RecordingAiRunnerDb,
    actor,
    workItem: claimed,
    now,
    draftBuilder,
    pipeline,
  });
}

export type RecordingAiClaimRunResult = {
  analyses: Array<{
    id: string;
    status: RecordingAiAnalysisStatus;
    attempt: number;
  }>;
  failures: Array<{ analysisId: string; errorSummary: string }>;
};

export const RECORDING_AI_CLAIM_DEFAULT_LIMIT = 5;
export const RECORDING_AI_CLAIM_MAX_LIMIT = 10;
export const RECORDING_AI_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
export const RECORDING_AI_STALE_CLAIM_ERROR_SUMMARY =
  "Recording AI claim timed out after the final attempt";

/**
 * Claims the next batch of runnable recording AI analyses for the runner
 * organization and executes them. Two kinds of rows are runnable:
 *
 * - queued rows, claimed with an optimistic lock on the status column
 *   (`update ... where id = ? and status = 'queued'`), so two concurrent
 *   runners can never execute the same analysis twice;
 * - running rows whose claimed_at is older than `claimTimeoutMs`: the runner
 *   that claimed them crashed mid-run and will never finish them. Reclaiming
 *   re-checks `claimed_at < cutoff` inside the conditional update, so a row
 *   freshly (re)claimed by a concurrent runner — which resets claimed_at to
 *   now — can not be stolen a second time.
 *
 * Both claim paths only consider rows with attempt < max_attempts. A stale
 * running row whose attempts are already exhausted can never be reclaimed, so
 * it is finalized as failed instead (reported under `failures`) rather than
 * left stuck in running forever.
 */
export async function claimAndRunRecordingAiAnalyses({
  client,
  actor,
  limit = RECORDING_AI_CLAIM_DEFAULT_LIMIT,
  claimTimeoutMs = RECORDING_AI_CLAIM_TIMEOUT_MS,
  now = () => new Date(),
  draftBuilder = buildRecordingAiAnalysisDraft,
  pipeline = null,
}: {
  client: Parameters<typeof recordAiInvocation>[0]["client"];
  actor: AiActor;
  limit?: number;
  claimTimeoutMs?: number;
  now?: () => Date;
  draftBuilder?: typeof buildRecordingAiAnalysisDraft;
  pipeline?: RecordingAiDraftPipeline | null;
}): Promise<RecordingAiClaimRunResult> {
  const db = client as unknown as RecordingAiRunnerDb;
  const batchLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(Math.trunc(limit), RECORDING_AI_CLAIM_MAX_LIMIT))
    : RECORDING_AI_CLAIM_DEFAULT_LIMIT;
  const staleBefore = new Date(
    now().getTime() - Math.max(0, claimTimeoutMs),
  ).toISOString();

  const candidateSelect = "id, attempt, max_attempts, created_at";

  const { data: queuedData, error: queuedError } = await db
    .from("recording_ai_analyses")
    .select(candidateSelect)
    .eq("organization_id", actor.organizationId)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(batchLimit);

  if (queuedError) {
    throw queuedError;
  }

  // Runner crash recovery: running rows whose claim outlived the timeout are
  // orphaned (a live run would have finished or requeued them by now).
  const { data: staleData, error: staleError } = await db
    .from("recording_ai_analyses")
    .select(candidateSelect)
    .eq("organization_id", actor.organizationId)
    .eq("status", "running")
    .lt("claimed_at", staleBefore)
    .order("created_at", { ascending: true })
    .limit(batchLimit);

  if (staleError) {
    throw staleError;
  }

  const hasAttemptsLeft = (row: RecordingAiClaimCandidateRow) =>
    Math.max(0, Math.trunc(row.attempt ?? 0)) <
    Math.max(1, Math.trunc(row.max_attempts ?? 3));

  const candidates = [
    ...(queuedData ?? []).map((row) => ({ row, staleRunning: false })),
    ...(staleData ?? []).map((row) => ({ row, staleRunning: true })),
  ]
    .filter(({ row }) => hasAttemptsLeft(row))
    .sort((left, right) =>
      left.row.created_at.localeCompare(right.row.created_at),
    )
    .slice(0, batchLimit);

  const analyses: RecordingAiClaimRunResult["analyses"] = [];
  const failures: RecordingAiClaimRunResult["failures"] = [];

  // A stale running row with no attempts left can never be reclaimed; finalize
  // it as failed so it does not sit in running forever.
  for (const row of (staleData ?? []).filter((row) => !hasAttemptsLeft(row))) {
    try {
      const finalized = await failStaleRunningRecordingAiAnalysis(
        db,
        row.id,
        staleBefore,
        now().toISOString(),
      );
      if (finalized) {
        failures.push({
          analysisId: row.id,
          errorSummary: RECORDING_AI_STALE_CLAIM_ERROR_SUMMARY,
        });
      }
    } catch (error) {
      failures.push({
        analysisId: row.id,
        errorSummary: sanitizeErrorSummary(error),
      });
    }
  }

  for (const { row: candidate, staleRunning } of candidates) {
    const attempt = Math.max(0, Math.trunc(candidate.attempt ?? 0)) + 1;

    let claimed: RecordingAiWorkItemRow | null = null;
    try {
      claimed = staleRunning
        ? await claimStaleRunningRecordingAiAnalysis(
            db,
            candidate.id,
            attempt,
            staleBefore,
            now().toISOString(),
          )
        : await claimQueuedRecordingAiAnalysis(
            db,
            candidate.id,
            attempt,
            now().toISOString(),
          );
    } catch (error) {
      failures.push({
        analysisId: candidate.id,
        errorSummary: sanitizeErrorSummary(error),
      });
      continue;
    }

    // Another runner claimed the analysis between listing and the conditional
    // update; skip it instead of double-running.
    if (!claimed) {
      continue;
    }

    if (claimed.organization_id !== actor.organizationId) {
      failures.push({
        analysisId: candidate.id,
        errorSummary: "Recording AI analysis belongs to another organization",
      });
      continue;
    }

    try {
      const result = await executeClaimedRecordingAiAnalysis({
        client: db,
        actor,
        workItem: claimed,
        now,
        draftBuilder,
        pipeline,
      });
      analyses.push({ id: result.id, status: result.status, attempt });
    } catch (error) {
      failures.push({
        analysisId: candidate.id,
        errorSummary: sanitizeErrorSummary(error),
      });
    }
  }

  return { analyses, failures };
}

function buildRecordingAiClaimPayload(
  attempt: number,
  claimedAt: string,
): Record<string, unknown> {
  return {
    status: "running",
    attempt,
    claimed_at: claimedAt,
    error_summary: null,
    completed_at: null,
  };
}

/**
 * Optimistic-lock claim: transitions the analysis queued -> running only when
 * it is still queued. Returns null when another runner already claimed it.
 */
async function claimQueuedRecordingAiAnalysis(
  db: RecordingAiRunnerDb,
  analysisId: string,
  attempt: number,
  claimedAt: string,
): Promise<RecordingAiWorkItemRow | null> {
  const { data, error } = await db
    .from("recording_ai_analyses")
    .update(buildRecordingAiClaimPayload(attempt, claimedAt))
    .eq("id", analysisId)
    .eq("status", "queued")
    .select(analysisWorkItemSelect)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

/**
 * Optimistic-lock reclaim of a running row orphaned by a crashed runner. The
 * `claimed_at < staleBefore` condition doubles as the lock: any concurrent
 * (re)claim resets claimed_at to a fresh timestamp, so at most one reclaimer
 * observes a stale value. Returns null when the row was finished, requeued or
 * reclaimed in the meantime.
 */
async function claimStaleRunningRecordingAiAnalysis(
  db: RecordingAiRunnerDb,
  analysisId: string,
  attempt: number,
  staleBefore: string,
  claimedAt: string,
): Promise<RecordingAiWorkItemRow | null> {
  const { data, error } = await db
    .from("recording_ai_analyses")
    .update(buildRecordingAiClaimPayload(attempt, claimedAt))
    .eq("id", analysisId)
    .eq("status", "running")
    .lt("claimed_at", staleBefore)
    .select(analysisWorkItemSelect)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

/**
 * Finalizes a stale running row whose attempts are exhausted: no runner may
 * reclaim it, so failed is its only reachable terminal state. Guarded by the
 * same `claimed_at < staleBefore` optimistic lock as reclaiming; returns false
 * when the original runner resolved the row in the meantime.
 */
async function failStaleRunningRecordingAiAnalysis(
  db: RecordingAiRunnerDb,
  analysisId: string,
  staleBefore: string,
  completedAt: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("recording_ai_analyses")
    .update({
      status: "failed",
      claimed_at: null,
      error_summary: RECORDING_AI_STALE_CLAIM_ERROR_SUMMARY,
      completed_at: completedAt,
    })
    .eq("id", analysisId)
    .eq("status", "running")
    .lt("claimed_at", staleBefore)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data !== null;
}

export async function executeClaimedRecordingAiAnalysis({
  client,
  actor,
  workItem,
  now,
  draftBuilder,
  pipeline = null,
  signal,
  onStage,
  beforeFinalize,
  deferTerminalStatus = false,
}: {
  client: RecordingAiRunnerDb;
  actor: AiExecutionActor;
  workItem: RecordingAiWorkItemRow;
  now: () => Date;
  draftBuilder: typeof buildRecordingAiAnalysisDraft;
  pipeline?: RecordingAiDraftPipeline | null;
  signal?: AbortSignal;
  onStage?: (stage: RecordingAiPipelineStage | "persisting") => Promise<void> | void;
  beforeFinalize?: (input: {
    status: "succeeded" | "failed" | "cancelled";
    errorCode: string | null;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  deferTerminalStatus?: boolean;
}): Promise<RecordingAiAnalysisDto> {
  void actor;
  const db = client;
  const analysisId = workItem.id;
  const attempt = Math.max(0, Math.trunc(workItem.attempt ?? 0));
  let finalizationAttempted = false;

  try {
    if (workItem.cancel_requested_at) {
      await onStage?.("persisting");
      if (beforeFinalize) {
        finalizationAttempted = true;
        await beforeFinalize({
          status: "cancelled",
          errorCode: null,
          metadata: { cancelledAt: workItem.cancel_requested_at },
        });
      }
      const updated = deferTerminalStatus
        ? {
            ...workItem,
            status: "cancelled" as const,
            completed_at: now().toISOString(),
            claimed_at: null,
            claimed_by: null,
            lease_expires_at: null,
          }
        : await updateAnalysis(db, analysisId, {
            status: "cancelled",
            claimed_at: null,
            error_summary: "cancelled",
            completed_at: now().toISOString(),
          });
      return toRecordingAiAnalysisDto(updated);
    }

    const asset = toRecordingAssetDtoFromWorkItem(workItem.recording_assets);

    // 优先走「抽音频 -> 豆包 ASR 转写 -> DeepSeek 分析」流水线；流水线不可用
    // （返回 null）或失败（抛错）时回退确定性草稿，分析任务本身不失败。
    let pipelineResult: RecordingAiPipelineResult | null = null;
    let pipelineError: string | null = null;
    if (pipeline) {
      try {
        pipelineResult = await pipeline({ asset, signal, onStage });
      } catch (error) {
        if (isAbortError(error)) {
          await onStage?.("persisting");
          if (beforeFinalize) {
            finalizationAttempted = true;
            await beforeFinalize({
              status: "cancelled",
              errorCode: null,
              metadata: { cancelledAt: now().toISOString() },
            });
          }
          const updated = deferTerminalStatus
            ? {
                ...workItem,
                status: "cancelled" as const,
                completed_at: now().toISOString(),
                claimed_at: null,
                claimed_by: null,
                lease_expires_at: null,
              }
            : await updateAnalysis(db, analysisId, {
                status: "cancelled",
                claimed_at: null,
                error_summary: "cancelled",
                completed_at: now().toISOString(),
              });
          return toRecordingAiAnalysisDto(updated);
        }
        pipelineError = sanitizeErrorSummary(error);
      }
    }

    const draft = pipelineResult?.draft ?? draftBuilder({ asset });
    if (!pipelineResult && pipelineError) {
      draft.riskFlags = [
        ...draft.riskFlags,
        `AI 转写分析不可用，已回退基础分析：${pipelineError}`,
      ];
    }

    const completedAt = now().toISOString();
    const segmentRows = draft.segments.map((segment) => ({
      organization_id: workItem.organization_id,
      analysis_id: analysisId,
      asset_id: workItem.asset_id,
      segment_kind: segment.segmentKind,
      start_seconds: segment.startSeconds,
      end_seconds: segment.endSeconds,
      title: segment.title,
      summary: segment.summary,
      risk_level: segment.riskLevel,
      evidence: segment.evidence,
      sort_order: segment.sortOrder,
    }));

    await onStage?.("persisting");
    if (beforeFinalize) {
      finalizationAttempted = true;
      await beforeFinalize({
        status: "succeeded",
        errorCode: null,
        metadata: {
          recordingResult: {
            assetId: workItem.asset_id,
            providerName: pipelineResult?.providerName ?? "deterministic",
            summary: draft.summary,
            scorecard: draft.scorecard,
            dimensions: draft.dimensions,
            riskFlags: draft.riskFlags,
            recommendations: draft.recommendations,
            transcriptText: pipelineResult?.transcriptText ?? null,
            transcriptUtterances: pipelineResult?.transcriptUtterances ?? [],
            asrProvider: pipelineResult?.asrProvider ?? null,
          },
          segments: segmentRows,
        },
      });
    }

    if (deferTerminalStatus) {
      return toRecordingAiAnalysisDto({
        ...workItem,
        status: "succeeded",
        provider_name: pipelineResult?.providerName ?? "deterministic",
        summary: draft.summary,
        scorecard: draft.scorecard,
        dimensions: draft.dimensions,
        risk_flags: draft.riskFlags,
        recommendations: draft.recommendations,
        transcript_text: pipelineResult?.transcriptText ?? null,
        asr_provider: pipelineResult?.asrProvider ?? null,
        completed_at: completedAt,
        recording_ai_segments:
          segmentRows.map((segment, index) => ({
            id: `segment-${index + 1}`,
            segment_kind: String(segment.segment_kind),
            start_seconds: Number(segment.start_seconds),
            end_seconds: Number(segment.end_seconds),
            title: String(segment.title),
            summary: String(segment.summary),
            risk_level: segment.risk_level as "low" | "medium" | "high",
            evidence: segment.evidence,
            sort_order: Number(segment.sort_order),
          })) ?? [],
      });
    }

    const updated = await updateAnalysis(db, analysisId, {
      status: "succeeded",
      claimed_at: null,
      provider_name: pipelineResult?.providerName ?? "deterministic",
      summary: draft.summary,
      scorecard: draft.scorecard,
      dimensions: draft.dimensions,
      risk_flags: draft.riskFlags,
      recommendations: draft.recommendations,
      transcript_text: pipelineResult?.transcriptText ?? null,
      transcript_utterances: pipelineResult?.transcriptUtterances ?? [],
      asr_provider: pipelineResult?.asrProvider ?? null,
      error_summary: null,
      completed_at: completedAt,
    });

    if (segmentRows.length > 0) {
      const { error } = await db
        .from("recording_ai_segments")
        .insert(segmentRows);
      if (error) {
        throw error;
      }
    }

    return toRecordingAiAnalysisDto({
      ...updated,
      status: deferTerminalStatus ? "succeeded" : updated.status,
      recording_ai_segments:
        segmentRows.map((segment, index) => ({
          id: `segment-${index + 1}`,
          segment_kind: String(segment.segment_kind),
          start_seconds: Number(segment.start_seconds),
          end_seconds: Number(segment.end_seconds),
          title: String(segment.title),
          summary: String(segment.summary),
          risk_level: segment.risk_level as "low" | "medium" | "high",
          evidence: segment.evidence,
          sort_order: Number(segment.sort_order),
        })) ?? [],
    });
  } catch (error) {
    if (finalizationAttempted) {
      throw error;
    }
    const finalFailure = attempt >= Math.max(1, workItem.max_attempts ?? 3);
    const completedAt = finalFailure ? now().toISOString() : null;
    if (finalFailure) {
      await onStage?.("persisting");
      if (beforeFinalize) {
        finalizationAttempted = true;
        await beforeFinalize({
          status: "failed",
          errorCode: "provider_failed",
          metadata: { errorSummary: sanitizeErrorSummary(error) },
        });
      }
    }
    if (finalFailure && deferTerminalStatus) {
      return toRecordingAiAnalysisDto({
        ...workItem,
        status: "failed",
        error_summary: sanitizeErrorSummary(error),
        completed_at: completedAt,
      });
    }
    const updated = await updateAnalysis(db, analysisId, {
      status: finalFailure ? "failed" : "queued",
      attempt,
      claimed_at: null,
      error_summary: sanitizeErrorSummary(error),
      completed_at: completedAt,
    });
    return toRecordingAiAnalysisDto(updated);
  }
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (error instanceof Error && error.name === "AbortError");
}

function buildSegments(
  asset: RecordingAssetDto,
): RecordingAiAnalysisDraft["segments"] {
  const duration = Math.max(600, Math.trunc(asset.durationSeconds ?? 1800));
  const openingEnd = Math.min(duration, 180);
  const interactionStart = Math.min(
    Math.max(240, Math.round(duration * 0.35)),
    duration,
  );
  const interactionEnd = Math.min(duration, interactionStart + 180);
  const riskStart = Math.max(0, duration - 180);

  return [
    {
      segmentKind: "opening",
      startSeconds: 0,
      endSeconds: openingEnd,
      title: "开场承接",
      summary: "复核开场是否快速交代产品、福利节点和观看理由。",
      riskLevel: "low",
      evidence: { source: `recording_asset:${asset.id}`, dimension: "rhythm" },
      sortOrder: 1,
    },
    {
      segmentKind: "interaction",
      startSeconds: interactionStart,
      endSeconds: interactionEnd,
      title: "互动密度",
      summary: "复核中段是否有评论引导、问题抛出和转化提醒。",
      riskLevel: "medium",
      evidence: {
        source: `recording_asset:${asset.id}`,
        dimension: "interaction",
      },
      sortOrder: 2,
    },
    {
      segmentKind: "risk",
      startSeconds: riskStart,
      endSeconds: duration,
      title: "风险复核",
      summary: "复核结尾是否存在承诺过度、违规引导或素材不可追溯问题。",
      riskLevel: asset.reviewStatus === "rejected" ? "high" : "medium",
      evidence: {
        source: `recording_asset:${asset.id}`,
        dimension: "compliance",
      },
      sortOrder: 3,
    },
  ];
}

async function loadRecordingAiWorkItem(
  db: RecordingAiRunnerDb,
  analysisId: string,
): Promise<RecordingAiWorkItemRow> {
  const { data, error } = await db
    .from("recording_ai_analyses")
    .select(analysisWorkItemSelect)
    .eq("id", analysisId)
    .single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Recording AI analysis not found");
  }

  return data;
}

async function updateAnalysis(
  db: RecordingAiRunnerDb,
  analysisId: string,
  payload: Record<string, unknown>,
): Promise<RecordingAiWorkItemRow> {
  const { data, error } = await db
    .from("recording_ai_analyses")
    .update(payload)
    .eq("id", analysisId)
    .select(analysisWorkItemSelect)
    .single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Failed to update recording AI analysis");
  }

  return data;
}

function toRecordingAssetDtoFromWorkItem(
  row: RecordingAssetWorkItemRow | null | undefined,
): RecordingAssetDto {
  if (!row) {
    throw new Error("Recording asset not found for analysis");
  }

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
    sources: (row.recording_asset_sources ?? []).map((source) => ({
      id: source.id,
      sourceKind: source.source_kind,
      previewState: source.preview_state,
      provider: source.provider,
      externalUrl: source.external_url,
      storagePath: source.storage_path,
      submittedAt: source.submitted_at,
      downloadUrl: null,
    })),
    aiAnalysis: null,
  });
}

function sanitizeErrorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : "analysis failed";
  return message
    .replace(/secret=([^\s;]+)/gi, "secret=[redacted]")
    .slice(0, 500);
}

function toSegmentDto(row: RecordingAiSegmentRow): RecordingAiSegmentDto {
  return {
    id: row.id,
    segmentKind: row.segment_kind,
    startSeconds: normalizeSeconds(row.start_seconds),
    endSeconds: normalizeSeconds(row.end_seconds),
    timeRangeLabel: `${formatTime(row.start_seconds)} - ${formatTime(
      row.end_seconds,
    )}`,
    title: row.title,
    summary: row.summary,
    riskLevel: row.risk_level,
    evidence: row.evidence ?? {},
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 0,
  };
}

function normalizeScorecard(
  value: unknown,
): Partial<Record<RecordingAiDimensionKey, number>> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const output: Partial<Record<RecordingAiDimensionKey, number>> = {};
  for (const key of [
    "rhythm",
    "script",
    "interaction",
    "media_quality",
    "compliance",
    "project_match",
  ] as RecordingAiDimensionKey[]) {
    const score = (value as Record<string, unknown>)[key];
    if (typeof score === "number" && Number.isFinite(score)) {
      output[key] = Math.max(0, Math.min(100, Math.trunc(score)));
    }
  }
  return output;
}

function normalizeDimensions(value: unknown): RecordingAiDimension[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const key = record.key;
      const label = record.label;
      const score = record.score;
      const finding = record.finding;
      if (
        !isDimensionKey(key) ||
        typeof label !== "string" ||
        typeof score !== "number" ||
        typeof finding !== "string"
      ) {
        return null;
      }
      return {
        key,
        label,
        score: Math.max(0, Math.min(100, Math.trunc(score))),
        finding,
      };
    })
    .filter((item): item is RecordingAiDimension => item !== null);
}

function normalizeRecommendations(value: unknown): RecordingAiRecommendation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      if (
        typeof record.title !== "string" ||
        typeof record.detail !== "string"
      ) {
        return null;
      }
      return {
        title: record.title,
        detail: record.detail,
        requiresHumanApproval: true as const,
      };
    })
    .filter((item): item is RecordingAiRecommendation => item !== null);
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isDimensionKey(value: unknown): value is RecordingAiDimensionKey {
  return (
    value === "rhythm" ||
    value === "script" ||
    value === "interaction" ||
    value === "media_quality" ||
    value === "compliance" ||
    value === "project_match"
  );
}

function normalizeSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function formatTime(value: number): string {
  const seconds = normalizeSeconds(value);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
