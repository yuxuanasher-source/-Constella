import { writeAuditLog } from "@/lib/audit/audit";
import type { AiActor } from "@/features/ai/contracts";

import {
  defaultRecordingQualityThresholds,
  type RecordingQualityThresholds,
} from "./recording-quality-analysis";
import {
  defaultScriptBenchmark,
  type ScriptBenchmark,
} from "./recording-script-analysis";
import {
  defaultCapabilityWeights,
  type CapabilityWeights,
} from "./streamer-capability-scoring";

/**
 * 组织自学习校准：全量读取组织履约数据（录屏上传、上播测试、排班开播），
 * 计算上传率 / 上播测试通过率 / 上播率，定位漏斗卡点，并据此迭代评分权重
 * 与话术基线。每次学习产出一个递增版本的校准快照，后续分析自动使用最新
 * 版本——这就是「自我学习、自我迭代」的落地机制：数据变化 -> 校准版本
 * 前进 -> 分析口径跟着组织实际表现演进。
 */

export type OrganizationFunnelHistory = {
  windowDays: number;
  streamerCount: number;
  uploadCount: number;
  uploadStreamerCount: number;
  liveTestCount: number;
  liveTestPassCount: number;
  scheduledTaskCount: number;
  startedTaskCount: number;
};

export type TopCohortScriptSample = {
  conversionRatioBps: number;
  gameExplainRatioBps: number;
  interactionRatioBps: number;
};

export type FunnelStage = "upload" | "live_test" | "go_live";

export type FunnelBottleneck = {
  stage: FunnelStage;
  label: string;
  actualBps: number;
  targetBps: number;
  severity: "low" | "medium" | "high";
  finding: string;
  recommendation: string;
};

export type RecordingIntelligenceCalibration = {
  version: number;
  source: "default" | "learned";
  sampleCounts: Record<string, number>;
  uploadRateBps: number;
  goLiveRateBps: number;
  liveTestPassRateBps: number;
  qualityThresholds: RecordingQualityThresholds;
  scriptBenchmark: ScriptBenchmark;
  capabilityWeights: CapabilityWeights;
  bottlenecks: FunnelBottleneck[];
};

export const funnelStageTargetsBps: Record<FunnelStage, number> = {
  upload: 8000,
  live_test: 6000,
  go_live: 8500,
};

const funnelStageLabels: Record<FunnelStage, string> = {
  upload: "素材上传",
  live_test: "上播测试",
  go_live: "排班开播",
};

const funnelStageRecommendations: Record<FunnelStage, string> = {
  upload:
    "上传率低说明素材采集环节卡住：检查录屏上传入口是否顺畅，并把上传纳入主播周任务。",
  live_test:
    "上播测试通过率低说明准入质量卡住：把校准后的话术与画面达标线同步给主播，测试前先做模拟评审。",
  go_live:
    "上播率低说明排班执行卡住：开播前确认档期、开播提醒和设备状态，跟进未开播原因。",
};

export function defaultRecordingIntelligenceCalibration(): RecordingIntelligenceCalibration {
  return {
    version: 0,
    source: "default",
    sampleCounts: {},
    uploadRateBps: 0,
    goLiveRateBps: 0,
    liveTestPassRateBps: 0,
    qualityThresholds: { ...defaultRecordingQualityThresholds },
    scriptBenchmark: { ...defaultScriptBenchmark },
    capabilityWeights: { ...defaultCapabilityWeights },
    bottlenecks: [],
  };
}

/**
 * 纯函数：根据组织漏斗历史与高分主播话术样本，产出下一版校准。
 * 迭代规则是确定性的、可审计的：
 * - 上播测试通过率低于目标 -> 评分权重向「话术流畅度 / 游戏熟练度」倾斜；
 * - 上播率低于目标 -> 权重向「互动积极性」小幅倾斜，同时输出运营跟进建议；
 * - 高分主播话术样本 >= 3 场时，话术基线切换为组织实测均值（org_calibrated）。
 */
export function buildRecordingIntelligenceCalibration({
  history,
  topCohortScriptSamples = [],
  previous,
}: {
  history: OrganizationFunnelHistory;
  topCohortScriptSamples?: TopCohortScriptSample[];
  previous?: Pick<RecordingIntelligenceCalibration, "version"> | null;
}): RecordingIntelligenceCalibration {
  const uploadRateBps = ratioBps(
    history.uploadStreamerCount,
    history.streamerCount,
  );
  const liveTestPassRateBps = ratioBps(
    history.liveTestPassCount,
    history.liveTestCount,
  );
  const goLiveRateBps = ratioBps(
    history.startedTaskCount,
    history.scheduledTaskCount,
  );

  const bottlenecks = buildBottlenecks({
    upload: {
      actualBps: uploadRateBps,
      sampleSize: history.streamerCount,
    },
    live_test: {
      actualBps: liveTestPassRateBps,
      sampleSize: history.liveTestCount,
    },
    go_live: {
      actualBps: goLiveRateBps,
      sampleSize: history.scheduledTaskCount,
    },
  });

  const capabilityWeights = calibrateWeights(bottlenecks);
  const scriptBenchmark = calibrateScriptBenchmark(topCohortScriptSamples);

  return {
    version: Math.max(0, Math.trunc(previous?.version ?? 0)) + 1,
    source: "learned",
    sampleCounts: {
      streamerCount: history.streamerCount,
      uploadCount: history.uploadCount,
      uploadStreamerCount: history.uploadStreamerCount,
      liveTestCount: history.liveTestCount,
      liveTestPassCount: history.liveTestPassCount,
      scheduledTaskCount: history.scheduledTaskCount,
      startedTaskCount: history.startedTaskCount,
      topCohortScriptSamples: topCohortScriptSamples.length,
      windowDays: history.windowDays,
    },
    uploadRateBps,
    goLiveRateBps,
    liveTestPassRateBps,
    qualityThresholds: { ...defaultRecordingQualityThresholds },
    scriptBenchmark,
    capabilityWeights,
    bottlenecks,
  };
}

/** 单主播口径的历史履约统计，供能力报告使用。 */
export function buildStreamerHistoryStats({
  uploadCount,
  scheduledTaskCount,
  startedTaskCount,
  liveTestCount,
  liveTestPassCount,
}: {
  uploadCount: number;
  scheduledTaskCount: number;
  startedTaskCount: number;
  liveTestCount: number;
  liveTestPassCount: number;
}) {
  return {
    uploadCount: Math.max(0, Math.trunc(uploadCount)),
    goLiveRateBps:
      scheduledTaskCount > 0
        ? ratioBps(startedTaskCount, scheduledTaskCount)
        : 10000,
    liveTestPassRateBps:
      liveTestCount > 0 ? ratioBps(liveTestPassCount, liveTestCount) : 10000,
  };
}

const MIN_STAGE_SAMPLE = 3;

function buildBottlenecks(
  stages: Record<FunnelStage, { actualBps: number; sampleSize: number }>,
): FunnelBottleneck[] {
  const bottlenecks: FunnelBottleneck[] = [];

  for (const stage of ["upload", "live_test", "go_live"] as FunnelStage[]) {
    const { actualBps, sampleSize } = stages[stage];
    const targetBps = funnelStageTargetsBps[stage];
    // 样本太少时不下卡点结论，避免小样本噪声驱动权重震荡。
    if (sampleSize < MIN_STAGE_SAMPLE || actualBps >= targetBps) {
      continue;
    }

    const shortfall = targetBps - actualBps;
    bottlenecks.push({
      stage,
      label: funnelStageLabels[stage],
      actualBps,
      targetBps,
      severity: shortfall > 3000 ? "high" : shortfall > 1000 ? "medium" : "low",
      finding: `${funnelStageLabels[stage]}转化率 ${formatBps(
        actualBps,
      )}，低于目标 ${formatBps(targetBps)}（样本 ${sampleSize}）。`,
      recommendation: funnelStageRecommendations[stage],
    });
  }

  return bottlenecks;
}

function calibrateWeights(
  bottlenecks: FunnelBottleneck[],
): CapabilityWeights {
  const weights: CapabilityWeights = { ...defaultCapabilityWeights };

  if (bottlenecks.some((item) => item.stage === "live_test")) {
    weights.script_fluency += 800;
    weights.game_proficiency += 400;
  }
  if (bottlenecks.some((item) => item.stage === "go_live")) {
    weights.interaction_activity += 400;
  }

  return normalizeWeights(weights);
}

const MIN_BENCHMARK_SAMPLES = 3;

function calibrateScriptBenchmark(
  samples: TopCohortScriptSample[],
): ScriptBenchmark {
  if (samples.length < MIN_BENCHMARK_SAMPLES) {
    return { ...defaultScriptBenchmark };
  }

  return {
    conversionRatioBps: averageBps(
      samples.map((sample) => sample.conversionRatioBps),
    ),
    gameExplainRatioBps: averageBps(
      samples.map((sample) => sample.gameExplainRatioBps),
    ),
    interactionRatioBps: averageBps(
      samples.map((sample) => sample.interactionRatioBps),
    ),
    source: "org_calibrated",
    sampleSize: samples.length,
  };
}

function normalizeWeights(weights: CapabilityWeights): CapabilityWeights {
  const entries = Object.entries(weights) as Array<
    [keyof CapabilityWeights, number]
  >;
  const total = entries.reduce((sum, [, value]) => sum + Math.max(0, value), 0);
  if (total <= 0) {
    return { ...defaultCapabilityWeights };
  }

  const normalized = {} as CapabilityWeights;
  let assigned = 0;
  entries.forEach(([key, value], index) => {
    if (index === entries.length - 1) {
      normalized[key] = 10000 - assigned;
      return;
    }
    const share = Math.round((Math.max(0, value) / total) * 10000);
    normalized[key] = share;
    assigned += share;
  });
  return normalized;
}

// ---------------------------------------------------------------------------
// 服务层：读取组织数据 -> 学习 -> 持久化版本化校准
// ---------------------------------------------------------------------------

type CountableRow = { id: string };

type WindowedListResult<Row> = PromiseLike<{
  data: Row[] | null;
  error: Error | null;
}>;

type WindowedQuery<Row> = {
  select(columns: string): {
    eq(
      column: string,
      value: string,
    ): {
      gte(
        column: string,
        value: string,
      ): {
        limit(count: number): WindowedListResult<Row>;
      };
      order(
        column: string,
        options: { ascending: boolean },
      ): {
        limit(count: number): WindowedListResult<Row>;
      };
      limit(count: number): WindowedListResult<Row>;
    };
  };
};

export type RecordingIntelligenceLearningDb = {
  from(table: "streamers"): WindowedQuery<CountableRow>;
  from(
    table: "recording_assets",
  ): WindowedQuery<{ id: string; streamer_id: string | null }>;
  from(
    table: "recording_submissions",
  ): WindowedQuery<{ id: string; status: string }>;
  from(
    table: "live_tasks",
  ): WindowedQuery<{ id: string; system_duration: number | null }>;
  from(
    table: "recording_script_insights",
  ): WindowedQuery<{
    id: string;
    asset_id: string;
    category_stats: unknown;
    transcript_source: string;
  }>;
  from(
    table: "streamer_capability_reports",
  ): WindowedQuery<{ id: string; asset_id: string; grade: string }>;
  from(table: "recording_intelligence_calibrations"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        order(
          column: string,
          options: { ascending: boolean },
        ): {
          limit(count: number): WindowedListResult<CalibrationRow>;
        };
      };
    };
    insert(payload: Record<string, unknown>): {
      select(columns: string): {
        single(): PromiseLike<{
          data: CalibrationRow | null;
          error: Error | null;
        }>;
      };
    };
  };
};

export type CalibrationRow = {
  id: string;
  version: number;
  source: string;
  sample_counts: unknown;
  upload_rate_bps: number;
  go_live_rate_bps: number;
  live_test_pass_rate_bps: number;
  quality_thresholds: unknown;
  script_benchmark: unknown;
  capability_weights: unknown;
  bottlenecks: unknown;
  created_at: string;
};

const HISTORY_WINDOW_DAYS = 90;
const HISTORY_ROW_LIMIT = 1000;
const TOP_COHORT_ROW_LIMIT = 50;

export async function learnRecordingIntelligenceCalibration({
  client,
  actor,
  now = () => new Date(),
}: {
  client: RecordingIntelligenceLearningDb;
  actor: AiActor;
  now?: () => Date;
}): Promise<RecordingIntelligenceCalibration> {
  const windowStart = new Date(
    now().getTime() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const organizationId = actor.organizationId;

  const [streamers, assets, submissions, tasks] = await Promise.all([
    listRows(
      client.from("streamers").select("id").eq("organization_id", organizationId),
    ),
    listRows(
      client
        .from("recording_assets")
        .select("id, streamer_id")
        .eq("organization_id", organizationId)
        .gte("created_at", windowStart),
    ),
    listRows(
      client
        .from("recording_submissions")
        .select("id, status")
        .eq("organization_id", organizationId)
        .gte("created_at", windowStart),
    ),
    listRows(
      client
        .from("live_tasks")
        .select("id, system_duration")
        .eq("organization_id", organizationId)
        .gte("created_at", windowStart),
    ),
  ]);

  const history: OrganizationFunnelHistory = {
    windowDays: HISTORY_WINDOW_DAYS,
    streamerCount: streamers.length,
    uploadCount: assets.length,
    uploadStreamerCount: new Set(
      assets
        .map((asset) => asset.streamer_id)
        .filter((value): value is string => Boolean(value)),
    ).size,
    liveTestCount: submissions.length,
    liveTestPassCount: submissions.filter(
      (submission) => submission.status === "approved",
    ).length,
    scheduledTaskCount: tasks.length,
    startedTaskCount: tasks.filter(
      (task) => (task.system_duration ?? 0) > 0,
    ).length,
  };

  const topCohortScriptSamples = await listTopCohortScriptSamples(
    client,
    organizationId,
    windowStart,
  );
  const previous = await loadLatestCalibrationRow(client, organizationId);

  const calibration = buildRecordingIntelligenceCalibration({
    history,
    topCohortScriptSamples,
    previous: previous ? { version: previous.version } : null,
  });

  const { data, error } = await client
    .from("recording_intelligence_calibrations")
    .insert({
      organization_id: organizationId,
      version: calibration.version,
      source: calibration.source,
      sample_counts: calibration.sampleCounts,
      upload_rate_bps: calibration.uploadRateBps,
      go_live_rate_bps: calibration.goLiveRateBps,
      live_test_pass_rate_bps: calibration.liveTestPassRateBps,
      quality_thresholds: calibration.qualityThresholds,
      script_benchmark: calibration.scriptBenchmark,
      capability_weights: calibration.capabilityWeights,
      bottlenecks: calibration.bottlenecks,
      created_by: actor.userId,
    })
    .select(calibrationSelect)
    .single();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Failed to persist recording intelligence calibration");
  }

  await writeAuditLog(client as unknown as Parameters<typeof writeAuditLog>[0], {
    organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "recording_intelligence",
    objectType: "recording_intelligence_calibration",
    objectId: data.id,
    after: {
      version: calibration.version,
      uploadRateBps: calibration.uploadRateBps,
      goLiveRateBps: calibration.goLiveRateBps,
      liveTestPassRateBps: calibration.liveTestPassRateBps,
      bottleneckStages: calibration.bottlenecks.map((item) => item.stage),
    },
    changedFields: ["calibration"],
  });

  return toCalibration(data);
}

export async function loadActiveRecordingIntelligenceCalibration({
  client,
  organizationId,
}: {
  client: RecordingIntelligenceLearningDb;
  organizationId: string;
}): Promise<RecordingIntelligenceCalibration> {
  const row = await loadLatestCalibrationRow(client, organizationId);
  return row ? toCalibration(row) : defaultRecordingIntelligenceCalibration();
}

export const calibrationSelect = [
  "id",
  "version",
  "source",
  "sample_counts",
  "upload_rate_bps",
  "go_live_rate_bps",
  "live_test_pass_rate_bps",
  "quality_thresholds",
  "script_benchmark",
  "capability_weights",
  "bottlenecks",
  "created_at",
].join(", ");

async function loadLatestCalibrationRow(
  client: RecordingIntelligenceLearningDb,
  organizationId: string,
): Promise<CalibrationRow | null> {
  const { data, error } = await client
    .from("recording_intelligence_calibrations")
    .select(calibrationSelect)
    .eq("organization_id", organizationId)
    .order("version", { ascending: false })
    .limit(1);

  if (error) {
    throw error;
  }

  return data?.[0] ?? null;
}

/**
 * 高分主播话术样本：取观察窗口内 grade 为 S/A 的能力报告，回查同资产的
 * 话术洞察（必须有真实转写），作为组织话术基线的校准输入。
 */
async function listTopCohortScriptSamples(
  client: RecordingIntelligenceLearningDb,
  organizationId: string,
  windowStart: string,
): Promise<TopCohortScriptSample[]> {
  const [reports, insights] = await Promise.all([
    listRows(
      client
        .from("streamer_capability_reports")
        .select("id, asset_id, grade")
        .eq("organization_id", organizationId)
        .gte("created_at", windowStart),
      TOP_COHORT_ROW_LIMIT,
    ),
    listRows(
      client
        .from("recording_script_insights")
        .select("id, asset_id, category_stats, transcript_source")
        .eq("organization_id", organizationId)
        .gte("created_at", windowStart),
      TOP_COHORT_ROW_LIMIT,
    ),
  ]);

  const topAssetIds = new Set(
    reports
      .filter((report) => report.grade === "S" || report.grade === "A")
      .map((report) => report.asset_id),
  );

  const samples: TopCohortScriptSample[] = [];
  for (const insight of insights) {
    if (
      !topAssetIds.has(insight.asset_id) ||
      insight.transcript_source !== "uploaded"
    ) {
      continue;
    }
    const sample = toScriptSample(insight.category_stats);
    if (sample) {
      samples.push(sample);
    }
  }
  return samples;
}

function toScriptSample(value: unknown): TopCohortScriptSample | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const ratios: Record<string, number> = {};
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.category === "string" &&
      typeof record.ratioBps === "number"
    ) {
      ratios[record.category] = record.ratioBps;
    }
  }
  if (
    ratios.conversion === undefined &&
    ratios.game_explain === undefined &&
    ratios.interaction === undefined
  ) {
    return null;
  }
  return {
    conversionRatioBps: clampBps(ratios.conversion ?? 0),
    gameExplainRatioBps: clampBps(ratios.game_explain ?? 0),
    interactionRatioBps: clampBps(ratios.interaction ?? 0),
  };
}

function toCalibration(row: CalibrationRow): RecordingIntelligenceCalibration {
  const fallback = defaultRecordingIntelligenceCalibration();
  return {
    version: Math.max(0, Math.trunc(row.version)),
    source: row.source === "learned" ? "learned" : "default",
    sampleCounts: normalizeCounts(row.sample_counts),
    uploadRateBps: clampBps(row.upload_rate_bps),
    goLiveRateBps: clampBps(row.go_live_rate_bps),
    liveTestPassRateBps: clampBps(row.live_test_pass_rate_bps),
    qualityThresholds: normalizeThresholds(
      row.quality_thresholds,
      fallback.qualityThresholds,
    ),
    scriptBenchmark: normalizeBenchmark(
      row.script_benchmark,
      fallback.scriptBenchmark,
    ),
    capabilityWeights: normalizeWeightRecord(
      row.capability_weights,
      fallback.capabilityWeights,
    ),
    bottlenecks: normalizeBottlenecks(row.bottlenecks),
  };
}

function normalizeCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const output: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      output[key] = Math.max(0, Math.trunc(raw));
    }
  }
  return output;
}

function normalizeThresholds(
  value: unknown,
  fallback: RecordingQualityThresholds,
): RecordingQualityThresholds {
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }
  const record = value as Record<string, unknown>;
  return {
    minEffectiveRatioBps: numberOr(record.minEffectiveRatioBps, fallback.minEffectiveRatioBps),
    maxIdleRatioBps: numberOr(record.maxIdleRatioBps, fallback.maxIdleRatioBps),
    minGameScreenRatioBps: numberOr(
      record.minGameScreenRatioBps,
      fallback.minGameScreenRatioBps,
    ),
    minFaceVisibleRatioBps: numberOr(
      record.minFaceVisibleRatioBps,
      fallback.minFaceVisibleRatioBps,
    ),
    minEffectiveSeconds: numberOr(
      record.minEffectiveSeconds,
      fallback.minEffectiveSeconds,
    ),
  };
}

function normalizeBenchmark(
  value: unknown,
  fallback: ScriptBenchmark,
): ScriptBenchmark {
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }
  const record = value as Record<string, unknown>;
  return {
    conversionRatioBps: clampBps(
      numberOr(record.conversionRatioBps, fallback.conversionRatioBps),
    ),
    gameExplainRatioBps: clampBps(
      numberOr(record.gameExplainRatioBps, fallback.gameExplainRatioBps),
    ),
    interactionRatioBps: clampBps(
      numberOr(record.interactionRatioBps, fallback.interactionRatioBps),
    ),
    source: record.source === "org_calibrated" ? "org_calibrated" : "default_high_roi",
    sampleSize: Math.max(0, Math.trunc(numberOr(record.sampleSize, 0))),
  };
}

function normalizeWeightRecord(
  value: unknown,
  fallback: CapabilityWeights,
): CapabilityWeights {
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }
  const record = value as Record<string, unknown>;
  return {
    game_proficiency: numberOr(record.game_proficiency, fallback.game_proficiency),
    script_fluency: numberOr(record.script_fluency, fallback.script_fluency),
    interaction_activity: numberOr(
      record.interaction_activity,
      fallback.interaction_activity,
    ),
    conversion_guidance: numberOr(
      record.conversion_guidance,
      fallback.conversion_guidance,
    ),
  };
}

function normalizeBottlenecks(value: unknown): FunnelBottleneck[] {
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
        (record.stage !== "upload" &&
          record.stage !== "live_test" &&
          record.stage !== "go_live") ||
        typeof record.finding !== "string" ||
        typeof record.recommendation !== "string"
      ) {
        return null;
      }
      return {
        stage: record.stage,
        label:
          typeof record.label === "string"
            ? record.label
            : funnelStageLabels[record.stage],
        actualBps: clampBps(numberOr(record.actualBps, 0)),
        targetBps: clampBps(numberOr(record.targetBps, 0)),
        severity:
          record.severity === "high" || record.severity === "medium"
            ? record.severity
            : "low",
        finding: record.finding,
        recommendation: record.recommendation,
      } satisfies FunnelBottleneck;
    })
    .filter((item): item is FunnelBottleneck => item !== null);
}

async function listRows<Row>(
  query: { limit(count: number): WindowedListResult<Row> },
  limit = HISTORY_ROW_LIMIT,
): Promise<Row[]> {
  const result = await query.limit(limit);
  if (result.error) {
    throw result.error;
  }
  return result.data ?? [];
}

function averageBps(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return clampBps(
    Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
  );
}

function ratioBps(part: number, whole: number): number {
  if (whole <= 0) {
    return 0;
  }
  return clampBps(Math.round((part / whole) * 10000));
}

function clampBps(value: number): number {
  return Math.max(0, Math.min(10000, Math.trunc(value)));
}

function formatBps(value: number): string {
  return `${(value / 100).toFixed(1)}%`;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}
