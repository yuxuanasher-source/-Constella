import type { RecordingQualityMetrics } from "./recording-quality-analysis";
import type { RecordingScriptInsights } from "./recording-script-analysis";
import type { RecordingRiskAlert } from "./recording-risk-detection";

/**
 * 主播能力自动评分：从游戏熟练度、话术流畅度、互动积极性、转化引导能力
 * 四个维度打分，叠加主播历史履约数据（上传率、上播率、上播测试通过率）
 * 与组织校准权重，生成能力报告和成长建议。报告只作诊断参考，人事与排班
 * 决策仍由人工做出。
 */

export type CapabilityDimensionKey =
  | "game_proficiency"
  | "script_fluency"
  | "interaction_activity"
  | "conversion_guidance";

export type CapabilityWeights = Record<CapabilityDimensionKey, number>;

export type StreamerHistoryStats = {
  /** 观察窗口内的录屏上传次数。 */
  uploadCount: number;
  /** 排班任务实际开播比例（bps）。 */
  goLiveRateBps: number;
  /** 上播测试（准入录屏审核）通过率（bps）。 */
  liveTestPassRateBps: number;
};

export type CapabilityDimension = {
  key: CapabilityDimensionKey;
  label: string;
  score: number;
  finding: string;
};

export type StreamerCapabilityGrade = "S" | "A" | "B" | "C";

export type StreamerCapabilityReport = {
  dimensions: CapabilityDimension[];
  overallScore: number;
  grade: StreamerCapabilityGrade;
  growthAdvice: string[];
  historyStats: StreamerHistoryStats;
  weights: CapabilityWeights;
};

export const capabilityDimensionLabels: Record<CapabilityDimensionKey, string> =
  {
    game_proficiency: "游戏熟练度",
    script_fluency: "话术流畅度",
    interaction_activity: "互动积极性",
    conversion_guidance: "转化引导能力",
  };

/** 默认等权配置；组织自学习校准会把权重向组织卡点维度倾斜。 */
export const defaultCapabilityWeights: CapabilityWeights = {
  game_proficiency: 2500,
  script_fluency: 2500,
  interaction_activity: 2500,
  conversion_guidance: 2500,
};

export function scoreStreamerCapability({
  quality,
  script,
  riskAlerts = [],
  history,
  weights = defaultCapabilityWeights,
}: {
  quality: RecordingQualityMetrics;
  script: RecordingScriptInsights;
  riskAlerts?: RecordingRiskAlert[];
  history: StreamerHistoryStats;
  weights?: CapabilityWeights;
}): StreamerCapabilityReport {
  const stats = statsByCategory(script);

  const gameProficiency = clampScore(
    Math.round(
      quality.gameScreenRatioBps / 200 + // 游戏画面占比最高贡献 50 分
        quality.effectiveRatioBps / 250 + // 有效时长占比最高贡献 40 分
        (stats.game_explain?.ratioBps ?? 0) / 1000, // 讲解密度最高贡献 10 分
    ),
  );

  const scriptFluency = clampScore(
    script.transcriptSource === "none"
      ? 40
      : Math.round(
          55 +
            perHourScore(stats.game_explain?.perHour ?? 0, 20, 25) +
            perHourScore(stats.conversion?.perHour ?? 0, 8, 20),
        ),
  );

  const interactionActivity = clampScore(
    script.transcriptSource === "none"
      ? 40
      : Math.round(
          40 +
            perHourScore(stats.interaction?.perHour ?? 0, 25, 40) +
            quality.faceVisibleRatioBps / 500, // 露脸状态最高贡献 20 分
        ),
  );

  const conversionGuidance = clampScore(
    script.transcriptSource === "none"
      ? 40
      : Math.round(
          35 +
            perHourScore(stats.conversion?.perHour ?? 0, 10, 45) +
            benchmarkBonus(script, "conversion"),
        ),
  );

  const highRiskCount = riskAlerts.filter(
    (alert) => alert.severity === "high",
  ).length;
  const riskPenalty = Math.min(30, highRiskCount * 10);

  const dimensions: CapabilityDimension[] = [
    {
      key: "game_proficiency",
      label: capabilityDimensionLabels.game_proficiency,
      score: gameProficiency,
      finding: `游戏画面占比 ${formatBps(quality.gameScreenRatioBps)}、有效时长占比 ${formatBps(quality.effectiveRatioBps)}。`,
    },
    {
      key: "script_fluency",
      label: capabilityDimensionLabels.script_fluency,
      score: scriptFluency,
      finding:
        script.transcriptSource === "none"
          ? "缺少语音转写，话术流畅度按保守基准给分。"
          : `每小时讲解 ${stats.game_explain?.perHour ?? 0} 句、转化引导 ${stats.conversion?.perHour ?? 0} 句。`,
    },
    {
      key: "interaction_activity",
      label: capabilityDimensionLabels.interaction_activity,
      score: interactionActivity,
      finding:
        script.transcriptSource === "none"
          ? "缺少语音转写，互动积极性按保守基准给分。"
          : `每小时互动话术 ${stats.interaction?.perHour ?? 0} 句，露脸占比 ${formatBps(quality.faceVisibleRatioBps)}。`,
    },
    {
      key: "conversion_guidance",
      label: capabilityDimensionLabels.conversion_guidance,
      score: conversionGuidance,
      finding:
        script.transcriptSource === "none"
          ? "缺少语音转写，转化引导能力按保守基准给分。"
          : `转化引导话术占比 ${formatBps(stats.conversion?.ratioBps ?? 0)}，基线 ${formatBps(script.benchmark.conversionRatioBps)}。`,
    },
  ];

  const weightedScore = weightedAverage(dimensions, weights);
  const overallScore = clampScore(weightedScore - riskPenalty);
  const grade = gradeForScore(overallScore);

  return {
    dimensions,
    overallScore,
    grade,
    growthAdvice: buildGrowthAdvice({
      dimensions,
      history,
      highRiskCount,
    }),
    historyStats: history,
    weights,
  };
}

function buildGrowthAdvice({
  dimensions,
  history,
  highRiskCount,
}: {
  dimensions: CapabilityDimension[];
  history: StreamerHistoryStats;
  highRiskCount: number;
}): string[] {
  const advice: string[] = [];

  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
  if (weakest && weakest.score < 75) {
    advice.push(
      `优先补强「${weakest.label}」（当前 ${weakest.score} 分），建议安排针对性培训或复盘对练。`,
    );
  }

  if (history.goLiveRateBps < 8000) {
    advice.push(
      `历史上播率 ${formatBps(history.goLiveRateBps)} 偏低，建议排班前确认档期并跟进开播打卡。`,
    );
  }
  if (history.liveTestPassRateBps < 6000) {
    advice.push(
      `上播测试通过率 ${formatBps(history.liveTestPassRateBps)} 偏低，建议在正式排班前增加试播演练。`,
    );
  }
  if (history.uploadCount === 0) {
    advice.push("观察窗口内没有录屏上传记录，建议先补齐素材再评估成长曲线。");
  }
  if (highRiskCount > 0) {
    advice.push(
      `本场存在 ${highRiskCount} 条高危告警，需完成合规培训并由运营确认后再排播。`,
    );
  }
  if (advice.length === 0) {
    advice.push("各维度均衡且历史履约健康，可作为高 ROI 话术模板的采集对象。");
  }

  return advice;
}

function statsByCategory(script: RecordingScriptInsights) {
  return Object.fromEntries(
    script.categoryStats.map((stat) => [stat.category, stat]),
  ) as Partial<
    Record<
      "conversion" | "game_explain" | "interaction" | "other",
      RecordingScriptInsights["categoryStats"][number]
    >
  >;
}

/** perHour 达到 target 时拿满 maxPoints，线性递增。 */
function perHourScore(
  perHour: number,
  target: number,
  maxPoints: number,
): number {
  if (target <= 0) {
    return 0;
  }
  return Math.round(Math.min(1, perHour / target) * maxPoints);
}

function benchmarkBonus(
  script: RecordingScriptInsights,
  category: "conversion" | "game_explain" | "interaction",
): number {
  const gap = script.benchmarkGaps.find((item) => item.category === category);
  if (!gap) {
    return 0;
  }
  if (gap.verdict === "above") {
    return 20;
  }
  if (gap.verdict === "on_par") {
    return 12;
  }
  return 0;
}

function weightedAverage(
  dimensions: CapabilityDimension[],
  weights: CapabilityWeights,
): number {
  let totalWeight = 0;
  let weighted = 0;
  for (const dimension of dimensions) {
    const weight = Math.max(0, Math.trunc(weights[dimension.key] ?? 0));
    totalWeight += weight;
    weighted += dimension.score * weight;
  }
  if (totalWeight === 0) {
    return Math.round(
      dimensions.reduce((sum, dimension) => sum + dimension.score, 0) /
        Math.max(1, dimensions.length),
    );
  }
  return Math.round(weighted / totalWeight);
}

function gradeForScore(score: number): StreamerCapabilityGrade {
  if (score >= 90) {
    return "S";
  }
  if (score >= 80) {
    return "A";
  }
  if (score >= 65) {
    return "B";
  }
  return "C";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

function formatBps(value: number): string {
  return `${(value / 100).toFixed(1)}%`;
}
