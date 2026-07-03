import {
  createAiInvocationId,
  recordAiInvocation,
} from "@/features/ai/invocation-ledger";
import type { AiActor } from "@/features/ai/contracts";
import type { AppRole } from "@/lib/rbac/roles";

import {
  analyzeRecordingQuality,
  deriveQualitySignalsFromAsset,
  type RecordingQualityMetrics,
  type RecordingQualitySignals,
} from "./recording-quality-analysis";
import {
  analyzeRecordingScript,
  type RecordingScriptInsights,
  type RecordingTranscriptLine,
} from "./recording-script-analysis";
import {
  detectRecordingRisks,
  dispatchRecordingRiskAlerts,
  type RecordingOperationEvent,
  type RecordingRiskAlert,
} from "./recording-risk-detection";
import {
  scoreStreamerCapability,
  type StreamerCapabilityReport,
} from "./streamer-capability-scoring";
import {
  buildStreamerHistoryStats,
  loadActiveRecordingIntelligenceCalibration,
  type RecordingIntelligenceCalibration,
  type RecordingIntelligenceLearningDb,
} from "./recording-intelligence-learning";

/**
 * 录屏智能分析编排器：一次调用完成质量结构化分析、话术与转化分析、违规
 * 风险检测和主播能力评分，全部使用组织最新的自学习校准口径，结果落库并
 * 对高危告警即时通知运营。分析结论只作为审核辅助——不自动通过、不自动
 * 驳回、不自动处罚主播。
 */

export const recordingIntelligenceReviewBoundary =
  "录屏智能分析仅作为审核与运营辅助，不自动通过、不自动驳回、不自动处罚；高危告警需运营人工确认后处置。";

export type RecordingIntelligenceInput = {
  signals?: RecordingQualitySignals;
  transcript?: RecordingTranscriptLine[];
  operationEvents?: RecordingOperationEvent[];
};

export type RecordingIntelligenceReportDto = {
  assetId: string;
  assetTitle: string;
  streamerId: string | null;
  calibrationVersion: number;
  generatedAt: string;
  quality: RecordingQualityMetrics;
  script: RecordingScriptInsights;
  riskAlerts: RecordingRiskAlert[];
  alertNotificationsSent: number;
  capability: StreamerCapabilityReport | null;
  reviewBoundary: string;
  aiInvocationId: string;
};

type IntelligenceAssetRow = {
  id: string;
  organization_id: string;
  streamer_id: string | null;
  project_id: string | null;
  title: string | null;
  duration_seconds: number | null;
  review_status: string;
};

type SingleResult<Row> = PromiseLike<{
  data: Row | null;
  error: Error | null;
}>;

type ListResult<Row> = PromiseLike<{
  data: Row[] | null;
  error: Error | null;
}>;

type RecordingIntelligenceDb = {
  from(table: "recording_assets"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): SingleResult<IntelligenceAssetRow>;
        eq(
          column: string,
          value: string,
        ): {
          gte(
            column: string,
            value: string,
          ): {
            limit(count: number): ListResult<{ id: string }>;
          };
        };
      };
    };
  };
  from(
    table: "live_tasks" | "recording_submissions",
  ): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(
          column: string,
          value: string,
        ): {
          gte(
            column: string,
            value: string,
          ): {
            limit(
              count: number,
            ): ListResult<{ id: string; system_duration?: number | null; status?: string }>;
          };
        };
      };
    };
  };
  from(
    table:
      | "recording_quality_metrics"
      | "recording_script_insights"
      | "recording_risk_alerts"
      | "streamer_capability_reports",
  ): {
    insert(
      payload: Record<string, unknown> | Record<string, unknown>[],
    ): PromiseLike<{ error: Error | null }>;
  };
};

type SnapshotQuery<Row> = {
  select(columns: string): {
    eq(
      column: string,
      value: string,
    ): {
      eq(
        column: string,
        value: string,
      ): {
        order(
          column: string,
          options: { ascending: boolean },
        ): {
          limit(count: number): ListResult<Row>;
        };
      };
    };
  };
};

type QualityMetricsRow = {
  duration_seconds: number;
  effective_seconds: number;
  idle_seconds: number;
  game_screen_ratio_bps: number;
  face_visible_ratio_bps: number;
  effective_ratio_bps: number;
  effectiveness_verdict: string;
  compliance_verdict: string;
  findings: unknown;
  signal_source: string;
  calibration_version: number;
  created_at: string;
};

type ScriptInsightsRow = {
  total_lines: number;
  category_stats: unknown;
  benchmark: unknown;
  benchmark_gaps: unknown;
  suggestions: unknown;
  transcript_source: string;
  calibration_version: number;
  created_at: string;
};

type RiskAlertRow = {
  id: string;
  category: string;
  severity: string;
  term: string;
  at_seconds: number;
  message: string;
  evidence: Record<string, unknown> | null;
  status: string;
  created_at: string;
};

type CapabilityReportRow = {
  streamer_id: string;
  dimensions: unknown;
  overall_score: number;
  grade: string;
  growth_advice: unknown;
  history_stats: unknown;
  calibration_version: number;
  created_at: string;
};

export type RecordingIntelligenceSnapshotDto = {
  assetId: string;
  quality: (RecordingQualityMetrics & {
    calibrationVersion: number;
    createdAt: string;
  }) | null;
  script: {
    totalLines: number;
    categoryStats: unknown[];
    benchmark: Record<string, unknown>;
    benchmarkGaps: unknown[];
    suggestions: unknown[];
    transcriptSource: string;
    calibrationVersion: number;
    createdAt: string;
  } | null;
  riskAlerts: Array<{
    id: string;
    category: string;
    severity: string;
    term: string;
    atSeconds: number;
    message: string;
    evidence: Record<string, unknown>;
    status: string;
    createdAt: string;
  }>;
  capability: {
    streamerId: string;
    dimensions: unknown[];
    overallScore: number;
    grade: string;
    growthAdvice: unknown[];
    historyStats: Record<string, unknown>;
    calibrationVersion: number;
    createdAt: string;
  } | null;
  reviewBoundary: string;
};

type RecordingIntelligenceSnapshotDb = {
  from(table: "recording_quality_metrics"): SnapshotQuery<QualityMetricsRow>;
  from(table: "recording_script_insights"): SnapshotQuery<ScriptInsightsRow>;
  from(table: "recording_risk_alerts"): SnapshotQuery<RiskAlertRow>;
  from(
    table: "streamer_capability_reports",
  ): SnapshotQuery<CapabilityReportRow>;
};

const SNAPSHOT_ALERT_LIMIT = 50;

/** 读取一个录屏资产的最新智能分析快照（各表取最近一次结果）。 */
export async function getRecordingIntelligenceReport({
  client,
  actor,
  assetId,
}: {
  client: RecordingIntelligenceSnapshotDb;
  actor: AiActor;
  assetId: string;
}): Promise<RecordingIntelligenceSnapshotDto> {
  const normalizedAssetId = assetId.trim();
  if (!normalizedAssetId) {
    throw new Error("Recording asset id is required");
  }

  const [quality, script, alerts, capability] = await Promise.all([
    latestRow(
      client.from("recording_quality_metrics"),
      actor.organizationId,
      normalizedAssetId,
      1,
    ),
    latestRow(
      client.from("recording_script_insights"),
      actor.organizationId,
      normalizedAssetId,
      1,
    ),
    latestRow(
      client.from("recording_risk_alerts"),
      actor.organizationId,
      normalizedAssetId,
      SNAPSHOT_ALERT_LIMIT,
    ),
    latestRow(
      client.from("streamer_capability_reports"),
      actor.organizationId,
      normalizedAssetId,
      1,
    ),
  ]);

  return {
    assetId: normalizedAssetId,
    quality: quality[0] ? toQualityDto(quality[0]) : null,
    script: script[0] ? toScriptDto(script[0]) : null,
    riskAlerts: alerts.map(toAlertDto),
    capability: capability[0] ? toCapabilityDto(capability[0]) : null,
    reviewBoundary: recordingIntelligenceReviewBoundary,
  };
}

async function latestRow<Row>(
  query: SnapshotQuery<Row>,
  organizationId: string,
  assetId: string,
  limit: number,
): Promise<Row[]> {
  const { data, error } = await query
    .select("*")
    .eq("organization_id", organizationId)
    .eq("asset_id", assetId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }
  return data ?? [];
}

function toQualityDto(row: QualityMetricsRow) {
  return {
    durationSeconds: row.duration_seconds,
    effectiveSeconds: row.effective_seconds,
    idleSeconds: row.idle_seconds,
    gameScreenRatioBps: row.game_screen_ratio_bps,
    faceVisibleRatioBps: row.face_visible_ratio_bps,
    effectiveRatioBps: row.effective_ratio_bps,
    effectivenessVerdict:
      row.effectiveness_verdict as RecordingQualityMetrics["effectivenessVerdict"],
    complianceVerdict:
      row.compliance_verdict as RecordingQualityMetrics["complianceVerdict"],
    findings: stringArray(row.findings),
    signalSource:
      row.signal_source === "uploaded"
        ? ("uploaded" as const)
        : ("derived" as const),
    calibrationVersion: row.calibration_version,
    createdAt: row.created_at,
  };
}

function toScriptDto(row: ScriptInsightsRow) {
  return {
    totalLines: row.total_lines,
    categoryStats: unknownArray(row.category_stats),
    benchmark: unknownRecord(row.benchmark),
    benchmarkGaps: unknownArray(row.benchmark_gaps),
    suggestions: unknownArray(row.suggestions),
    transcriptSource: row.transcript_source,
    calibrationVersion: row.calibration_version,
    createdAt: row.created_at,
  };
}

function toAlertDto(row: RiskAlertRow) {
  return {
    id: row.id,
    category: row.category,
    severity: row.severity,
    term: row.term,
    atSeconds: row.at_seconds,
    message: row.message,
    evidence: row.evidence ?? {},
    status: row.status,
    createdAt: row.created_at,
  };
}

function toCapabilityDto(row: CapabilityReportRow) {
  return {
    streamerId: row.streamer_id,
    dimensions: unknownArray(row.dimensions),
    overallScore: row.overall_score,
    grade: row.grade,
    growthAdvice: unknownArray(row.growth_advice),
    historyStats: unknownRecord(row.history_stats),
    calibrationVersion: row.calibration_version,
    createdAt: row.created_at,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function unknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const HISTORY_WINDOW_DAYS = 90;
const HISTORY_ROW_LIMIT = 500;
const MAX_TRANSCRIPT_LINES = 5000;
const MAX_OPERATION_EVENTS = 1000;
const MAX_FRAME_SAMPLES = 10000;

export function canRunRecordingIntelligence(role: AppRole): boolean {
  return (
    role === "owner" || role === "ops_manager" || role === "operator_business"
  );
}

export async function runRecordingIntelligence({
  client,
  actor,
  assetId,
  input = {},
  now = () => new Date(),
}: {
  client: RecordingIntelligenceDb;
  actor: AiActor;
  assetId: string;
  input?: RecordingIntelligenceInput;
  now?: () => Date;
}): Promise<RecordingIntelligenceReportDto> {
  if (!canRunRecordingIntelligence(actor.role)) {
    throw new Error("Only MCN staff can run recording intelligence analysis");
  }

  const normalizedAssetId = assetId.trim();
  if (!normalizedAssetId) {
    throw new Error("Recording asset id is required");
  }

  const asset = await loadAsset(client, normalizedAssetId);
  if (asset.organization_id !== actor.organizationId) {
    throw new Error("Recording asset is outside current organization");
  }

  const calibration = await loadActiveRecordingIntelligenceCalibration({
    client: client as unknown as RecordingIntelligenceLearningDb,
    organizationId: actor.organizationId,
  });

  const transcript = normalizeTranscript(input.transcript);
  const operationEvents = normalizeOperationEvents(input.operationEvents);
  const signals =
    input.signals && input.signals.frames.length > 0
      ? normalizeSignals(input.signals)
      : deriveQualitySignalsFromAsset({
          durationSeconds: asset.duration_seconds,
          reviewStatus:
            asset.review_status as Parameters<
              typeof deriveQualitySignalsFromAsset
            >[0]["reviewStatus"],
        });

  const riskAlerts = detectRecordingRisks({ transcript, operationEvents });
  const hasHighRisk = riskAlerts.some((alert) => alert.severity === "high");

  const quality = analyzeRecordingQuality({
    signals,
    thresholds: calibration.qualityThresholds,
    hasComplianceRiskSignal: hasHighRisk,
  });

  const script = analyzeRecordingScript({
    transcript,
    durationSeconds: quality.durationSeconds,
    benchmark: calibration.scriptBenchmark,
  });

  const capability = asset.streamer_id
    ? scoreStreamerCapability({
        quality,
        script,
        riskAlerts,
        history: await loadStreamerHistoryStats({
          client,
          organizationId: actor.organizationId,
          streamerId: asset.streamer_id,
          now,
        }),
        weights: calibration.capabilityWeights,
      })
    : null;

  const generatedAt = now().toISOString();
  await persistIntelligenceResults({
    client,
    actor,
    asset,
    calibration,
    quality,
    script,
    riskAlerts,
    capability,
  });

  const alertNotificationsSent = await dispatchRecordingRiskAlerts({
    client: client as unknown as Parameters<
      typeof dispatchRecordingRiskAlerts
    >[0]["client"],
    organizationId: actor.organizationId,
    assetId: asset.id,
    assetTitle: asset.title ?? "",
    alerts: riskAlerts,
  });

  const aiInvocationId = createAiInvocationId();
  await recordAiInvocation({
    client: client as unknown as Parameters<
      typeof recordAiInvocation
    >[0]["client"],
    actor,
    input: {
      id: aiInvocationId,
      scene: "recording.intelligence_report",
      objectType: "recording_asset",
      objectId: asset.id,
      providerName: "deterministic",
      status: "succeeded",
      metadata: {
        boundary: "human_review_required",
        calibrationVersion: calibration.version,
        riskAlertCount: riskAlerts.length,
        alertNotificationsSent,
      },
    },
  });

  return {
    assetId: asset.id,
    assetTitle: asset.title ?? "",
    streamerId: asset.streamer_id,
    calibrationVersion: calibration.version,
    generatedAt,
    quality,
    script,
    riskAlerts,
    alertNotificationsSent,
    capability,
    reviewBoundary: recordingIntelligenceReviewBoundary,
    aiInvocationId,
  };
}

async function persistIntelligenceResults({
  client,
  actor,
  asset,
  calibration,
  quality,
  script,
  riskAlerts,
  capability,
}: {
  client: RecordingIntelligenceDb;
  actor: AiActor;
  asset: IntelligenceAssetRow;
  calibration: RecordingIntelligenceCalibration;
  quality: RecordingQualityMetrics;
  script: RecordingScriptInsights;
  riskAlerts: RecordingRiskAlert[];
  capability: StreamerCapabilityReport | null;
}): Promise<void> {
  const base = {
    organization_id: actor.organizationId,
    asset_id: asset.id,
    calibration_version: calibration.version,
    created_by: actor.userId,
  };

  const qualityInsert = await client.from("recording_quality_metrics").insert({
    ...base,
    duration_seconds: quality.durationSeconds,
    effective_seconds: quality.effectiveSeconds,
    idle_seconds: quality.idleSeconds,
    game_screen_ratio_bps: quality.gameScreenRatioBps,
    face_visible_ratio_bps: quality.faceVisibleRatioBps,
    effective_ratio_bps: quality.effectiveRatioBps,
    effectiveness_verdict: quality.effectivenessVerdict,
    compliance_verdict: quality.complianceVerdict,
    findings: quality.findings,
    signal_source: quality.signalSource,
  });
  if (qualityInsert.error) {
    throw qualityInsert.error;
  }

  const scriptInsert = await client.from("recording_script_insights").insert({
    ...base,
    total_lines: script.totalLines,
    category_stats: script.categoryStats,
    benchmark: script.benchmark,
    benchmark_gaps: script.benchmarkGaps,
    suggestions: script.suggestions,
    transcript_source: script.transcriptSource,
  });
  if (scriptInsert.error) {
    throw scriptInsert.error;
  }

  if (riskAlerts.length > 0) {
    const alertInsert = await client.from("recording_risk_alerts").insert(
      riskAlerts.map((alert) => ({
        organization_id: actor.organizationId,
        asset_id: asset.id,
        category: alert.category,
        severity: alert.severity,
        term: alert.term,
        at_seconds: alert.atSeconds,
        message: alert.message,
        evidence: alert.evidence,
        status: "open",
      })),
    );
    if (alertInsert.error) {
      throw alertInsert.error;
    }
  }

  if (capability && asset.streamer_id) {
    const capabilityInsert = await client
      .from("streamer_capability_reports")
      .insert({
        ...base,
        streamer_id: asset.streamer_id,
        dimensions: capability.dimensions,
        overall_score: capability.overallScore,
        grade: capability.grade,
        growth_advice: capability.growthAdvice,
        history_stats: capability.historyStats,
      });
    if (capabilityInsert.error) {
      throw capabilityInsert.error;
    }
  }
}

async function loadAsset(
  client: RecordingIntelligenceDb,
  assetId: string,
): Promise<IntelligenceAssetRow> {
  const { data, error } = await client
    .from("recording_assets")
    .select(
      "id, organization_id, streamer_id, project_id, title, duration_seconds, review_status",
    )
    .eq("id", assetId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Recording asset not found");
  }
  return data;
}

async function loadStreamerHistoryStats({
  client,
  organizationId,
  streamerId,
  now,
}: {
  client: RecordingIntelligenceDb;
  organizationId: string;
  streamerId: string;
  now: () => Date;
}) {
  const windowStart = new Date(
    now().getTime() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [uploads, tasks, submissions] = await Promise.all([
    listStreamerRows(
      client
        .from("recording_assets")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("streamer_id", streamerId)
        .gte("created_at", windowStart),
    ),
    listStreamerRows(
      client
        .from("live_tasks")
        .select("id, system_duration")
        .eq("organization_id", organizationId)
        .eq("streamer_id", streamerId)
        .gte("created_at", windowStart),
    ),
    listStreamerRows(
      client
        .from("recording_submissions")
        .select("id, status")
        .eq("organization_id", organizationId)
        .eq("streamer_id", streamerId)
        .gte("created_at", windowStart),
    ),
  ]);

  return buildStreamerHistoryStats({
    uploadCount: uploads.length,
    scheduledTaskCount: tasks.length,
    startedTaskCount: tasks.filter(
      (task) => ((task as { system_duration?: number | null }).system_duration ?? 0) > 0,
    ).length,
    liveTestCount: submissions.length,
    liveTestPassCount: submissions.filter(
      (submission) =>
        (submission as { status?: string }).status === "approved",
    ).length,
  });
}

async function listStreamerRows<Row>(query: {
  limit(count: number): ListResult<Row>;
}): Promise<Row[]> {
  const { data, error } = await query.limit(HISTORY_ROW_LIMIT);
  if (error) {
    throw error;
  }
  return data ?? [];
}

function normalizeTranscript(
  value: RecordingTranscriptLine[] | undefined,
): RecordingTranscriptLine[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (line): line is RecordingTranscriptLine =>
        Boolean(line) &&
        typeof line.text === "string" &&
        typeof line.atSeconds === "number" &&
        Number.isFinite(line.atSeconds),
    )
    .slice(0, MAX_TRANSCRIPT_LINES)
    .map((line) => ({
      atSeconds: Math.max(0, Math.trunc(line.atSeconds)),
      text: line.text.slice(0, 500),
    }));
}

function normalizeOperationEvents(
  value: RecordingOperationEvent[] | undefined,
): RecordingOperationEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (event): event is RecordingOperationEvent =>
        Boolean(event) &&
        typeof event.kind === "string" &&
        typeof event.atSeconds === "number" &&
        Number.isFinite(event.atSeconds),
    )
    .slice(0, MAX_OPERATION_EVENTS)
    .map((event) => ({
      atSeconds: Math.max(0, Math.trunc(event.atSeconds)),
      kind: event.kind.slice(0, 100),
      detail:
        typeof event.detail === "string"
          ? event.detail.slice(0, 500)
          : undefined,
    }));
}

function normalizeSignals(
  signals: RecordingQualitySignals,
): RecordingQualitySignals {
  return {
    durationSeconds: Math.max(0, Math.trunc(signals.durationSeconds)),
    sampleIntervalSeconds: Math.max(
      1,
      Math.trunc(signals.sampleIntervalSeconds),
    ),
    frames: signals.frames.slice(0, MAX_FRAME_SAMPLES).map((frame) => ({
      atSeconds: Math.max(0, Math.trunc(frame.atSeconds)),
      isGameScreen: Boolean(frame.isGameScreen),
      isFaceVisible: Boolean(frame.isFaceVisible),
      isIdle: Boolean(frame.isIdle),
    })),
    source: "uploaded",
  };
}
