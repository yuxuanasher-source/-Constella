// 星耀 AI 助手 · 预测与风险预警雷达（L1 感知）。
// 基于统一特征库和可校准的特征权重，输出四类前瞻预测：
// 项目月度达标率、主播留存风险、账号封禁风险、回款逾期风险。
// 评分模型是确定性的加权求和（权重 bps 可被学习闭环校准并持久化到
// scoring_weights），每条预警都携带信号明细与应对建议；建议一律
// requiresHumanApproval，与 AI 安全分层保持一致。

import type { AgentOutput } from "./contracts";
import { validateAgentOutput } from "./agent-output-contract";
import {
  BROADCAST_RATE_TARGET_BPS,
  BPS_FLAT,
  clampBps,
  type XingyaoAccountFeature,
  type XingyaoFeatureStore,
  type XingyaoProjectFeature,
  type XingyaoSettlementFeature,
  type XingyaoStreamerFeature,
} from "./xingyao-feature-store";

const SOURCE_TOOL = "xingyao_risk_radar";

export const XINGYAO_RISK_MODELS = [
  "project_attainment",
  "streamer_retention",
  "account_ban",
  "settlement_overdue",
] as const;

export type XingyaoRiskModel = (typeof XINGYAO_RISK_MODELS)[number];

export const XINGYAO_RISK_MODEL_LABELS: Record<XingyaoRiskModel, string> = {
  project_attainment: "项目月度达标风险",
  streamer_retention: "主播留存风险",
  account_ban: "账号封禁风险",
  settlement_overdue: "回款逾期风险",
};

// 每个模型的信号权重（bps，0-10000）。学习闭环会按历史验证结果校准，
// 并可通过 xingyao-weight-repository 持久化 / 加载组织级覆盖值。
export type XingyaoRiskWeights = Record<
  XingyaoRiskModel,
  Record<string, number>
>;

export const DEFAULT_XINGYAO_RISK_WEIGHTS: XingyaoRiskWeights = {
  project_attainment: {
    progress_gap: 3_500,
    broadcast_shortfall: 2_500,
    traffic_decline: 2_000,
    conversion_decline: 2_000,
  },
  streamer_retention: {
    attendance_decline: 3_000,
    income_decline: 2_500,
    dispute_pressure: 1_500,
    inactivity: 2_000,
    training_gap: 1_000,
  },
  account_ban: {
    violation_density: 3_500,
    traffic_collapse: 2_000,
    live_hours_spike: 2_000,
    frozen_status: 2_500,
  },
  settlement_overdue: {
    overdue_exposure: 3_500,
    counterparty_history: 3_000,
    amount_concentration: 1_500,
    dispute_flag: 2_000,
  },
};

export const XINGYAO_RISK_SIGNAL_LABELS: Record<string, string> = {
  progress_gap: "月度目标进度缺口",
  broadcast_shortfall: "开播率缺口",
  traffic_decline: "流量下滑",
  conversion_decline: "转化下滑",
  attendance_decline: "上播率走弱",
  income_decline: "收入走弱",
  dispute_pressure: "争议压力",
  inactivity: "沉默天数",
  training_gap: "培训缺口",
  violation_density: "违规密度",
  traffic_collapse: "流量骤降",
  live_hours_spike: "直播时长异常",
  frozen_status: "账号状态异常",
  overdue_exposure: "逾期敞口",
  counterparty_history: "对手方历史逾期",
  amount_concentration: "金额集中度",
  dispute_flag: "争议标记",
};

export type XingyaoRiskSignal = {
  key: string;
  label: string;
  valueBps: number;
  weightBps: number;
  contributionBps: number;
};

export type XingyaoRiskLevel = "low" | "medium" | "high";

export const XINGYAO_RISK_LEVEL_LABELS: Record<XingyaoRiskLevel, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

const HIGH_RISK_THRESHOLD_BPS = 7_000;
const MEDIUM_RISK_THRESHOLD_BPS = 4_000;

export function riskLevelForScore(scoreBps: number): XingyaoRiskLevel {
  if (scoreBps >= HIGH_RISK_THRESHOLD_BPS) return "high";
  if (scoreBps >= MEDIUM_RISK_THRESHOLD_BPS) return "medium";
  return "low";
}

// 加权求和：score = Σ(value×weight)/Σweight，全程整数 bps，结果 0-10000。
export function scoreRiskSignals(
  values: Record<string, number>,
  weights: Record<string, number>,
): { scoreBps: number; signals: XingyaoRiskSignal[] } {
  const keys = Object.keys(values).sort();
  let weightedSum = 0;
  let totalWeight = 0;
  for (const key of keys) {
    const weight = Math.max(0, weights[key] ?? 0);
    weightedSum += clampBps(values[key]) * weight;
    totalWeight += weight;
  }
  const scoreBps = totalWeight > 0 ? clampBps(weightedSum / totalWeight) : 0;
  const signals = keys.map((key) => {
    const weight = Math.max(0, weights[key] ?? 0);
    return {
      key,
      label: XINGYAO_RISK_SIGNAL_LABELS[key] ?? key,
      valueBps: clampBps(values[key]),
      weightBps: weight,
      contributionBps:
        totalWeight > 0
          ? clampBps((clampBps(values[key]) * weight) / totalWeight)
          : 0,
    };
  });
  return { scoreBps, signals };
}

export type XingyaoRiskPrediction = {
  model: XingyaoRiskModel;
  objectType: "project" | "streamer" | "account" | "settlement";
  objectId: string;
  objectName: string;
  riskScoreBps: number;
  level: XingyaoRiskLevel;
  signals: XingyaoRiskSignal[];
  suggestion: string;
};

export type XingyaoProjectAttainmentPrediction = XingyaoRiskPrediction & {
  attainmentProbabilityBps: number;
};

function projectAttainmentSignalValues(
  project: XingyaoProjectFeature,
  periodElapsedRatioBps: number,
): Record<string, number> {
  const target = project.monthlyTargetRevenueCents ?? 0;
  let progressGap: number;
  if (target > 0 && periodElapsedRatioBps > 0) {
    const expectedToDateCents = (target * periodElapsedRatioBps) / BPS_FLAT;
    progressGap =
      expectedToDateCents > 0
        ? clampBps(
            ((expectedToDateCents - project.receivableCents) /
              expectedToDateCents) *
              BPS_FLAT,
          )
        : 0;
  } else {
    // 无月度目标时退化为收入环比走弱程度，避免凭空判定达标失败。
    progressGap = clampBps(BPS_FLAT - project.revenueTrendBps);
  }
  return {
    progress_gap: progressGap,
    broadcast_shortfall: clampBps(
      ((BROADCAST_RATE_TARGET_BPS - project.broadcastRateBps) /
        BROADCAST_RATE_TARGET_BPS) *
        BPS_FLAT,
    ),
    traffic_decline: clampBps(BPS_FLAT - project.trafficTrendBps),
    conversion_decline: clampBps(BPS_FLAT - project.conversionTrendBps),
  };
}

export function predictProjectMonthlyAttainment({
  project,
  periodElapsedRatioBps,
  weights = DEFAULT_XINGYAO_RISK_WEIGHTS,
}: {
  project: XingyaoProjectFeature;
  periodElapsedRatioBps: number;
  weights?: XingyaoRiskWeights;
}): XingyaoProjectAttainmentPrediction {
  const { scoreBps, signals } = scoreRiskSignals(
    projectAttainmentSignalValues(project, periodElapsedRatioBps),
    weights.project_attainment,
  );
  return {
    model: "project_attainment",
    objectType: "project",
    objectId: project.id,
    objectName: project.name,
    riskScoreBps: scoreBps,
    attainmentProbabilityBps: BPS_FLAT - scoreBps,
    level: riskLevelForScore(scoreBps),
    signals,
    suggestion:
      "对齐月度目标拆解到周排班与账号计划，优先补齐进度缺口最大的环节",
  };
}

export function predictStreamerRetention({
  streamer,
  weights = DEFAULT_XINGYAO_RISK_WEIGHTS,
}: {
  streamer: XingyaoStreamerFeature;
  weights?: XingyaoRiskWeights;
}): XingyaoRiskPrediction {
  const { scoreBps, signals } = scoreRiskSignals(
    {
      attendance_decline: clampBps(BPS_FLAT - streamer.showRateTrendBps),
      income_decline: clampBps(BPS_FLAT - streamer.incomeTrendBps),
      dispute_pressure: clampBps(streamer.disputeCount * 2_500),
      inactivity: clampBps(streamer.daysSinceLastLive * 500),
      training_gap: clampBps(BPS_FLAT - streamer.trainingCompletedRatioBps),
    },
    weights.streamer_retention,
  );
  return {
    model: "streamer_retention",
    objectType: "streamer",
    objectId: streamer.id,
    objectName: streamer.name,
    riskScoreBps: scoreBps,
    level: riskLevelForScore(scoreBps),
    signals,
    suggestion: "安排运营一对一回访确认续约意愿，优先解决收入走弱与争议问题",
  };
}

export function predictAccountBanRisk({
  account,
  weights = DEFAULT_XINGYAO_RISK_WEIGHTS,
}: {
  account: XingyaoAccountFeature;
  weights?: XingyaoRiskWeights;
}): XingyaoRiskPrediction {
  const frozenStatus =
    account.status === "frozen"
      ? BPS_FLAT
      : account.status === "idle"
        ? 3_000
        : 0;
  const { scoreBps, signals } = scoreRiskSignals(
    {
      violation_density: account.violationDensityBps,
      traffic_collapse: clampBps(BPS_FLAT - account.trafficTrendBps),
      live_hours_spike: account.liveHoursSpikeBps,
      frozen_status: frozenStatus,
    },
    weights.account_ban,
  );
  return {
    model: "account_ban",
    objectType: "account",
    objectId: account.id,
    objectName: `${account.platform}:${account.handle}`,
    riskScoreBps: scoreBps,
    level: riskLevelForScore(scoreBps),
    signals,
    suggestion:
      "立即自查近期违规记录并降低单日直播强度，必要时启用备用账号承接排班",
  };
}

export function predictSettlementOverdueRisk({
  settlement,
  weights = DEFAULT_XINGYAO_RISK_WEIGHTS,
}: {
  settlement: XingyaoSettlementFeature;
  weights?: XingyaoRiskWeights;
}): XingyaoRiskPrediction {
  const overdueExposure =
    settlement.overdueDays > 0
      ? clampBps(settlement.overdueDays * 1_000)
      : settlement.dueInDays <= 3
        ? 2_000
        : 0;
  const { scoreBps, signals } = scoreRiskSignals(
    {
      overdue_exposure: overdueExposure,
      counterparty_history: clampBps(settlement.counterpartyPastOverdueRateBps),
      amount_concentration: settlement.amountShareBps,
      dispute_flag: settlement.disputed ? BPS_FLAT : 0,
    },
    weights.settlement_overdue,
  );
  return {
    model: "settlement_overdue",
    objectType: "settlement",
    objectId: settlement.id,
    objectName: settlement.counterparty,
    riskScoreBps: scoreBps,
    level: riskLevelForScore(scoreBps),
    signals,
    suggestion:
      "提前对账并向对手方发出回款提醒，高敞口批次同步升级到财务负责人跟进",
  };
}

export type XingyaoRiskRadarResult = {
  predictions: XingyaoRiskPrediction[];
  alerts: XingyaoRiskPrediction[];
  output: AgentOutput;
  validation: ReturnType<typeof validateAgentOutput>;
};

const MODEL_ALERT_RECOMMENDATIONS: Record<XingyaoRiskModel, string> = {
  project_attainment:
    "对高风险项目启动周度达标作战会，把目标缺口拆到主播与账号层执行",
  streamer_retention:
    "对高风险主播启动留存干预：回访沟通、收入结构复核与档期调整",
  account_ban: "对高风险账号执行合规自查与限流观察，并准备替代账号预案",
  settlement_overdue: "对高风险回款批次提前催收对账，并评估后续合作的账期条款",
};

export function runXingyaoRiskRadar({
  store,
  weights = DEFAULT_XINGYAO_RISK_WEIGHTS,
}: {
  store: XingyaoFeatureStore;
  weights?: XingyaoRiskWeights;
}): XingyaoRiskRadarResult {
  const predictions: XingyaoRiskPrediction[] = [
    ...store.projects.map((project) =>
      predictProjectMonthlyAttainment({
        project,
        periodElapsedRatioBps: store.periodElapsedRatioBps,
        weights,
      }),
    ),
    ...store.streamers.map((streamer) =>
      predictStreamerRetention({ streamer, weights }),
    ),
    ...store.accounts.map((account) =>
      predictAccountBanRisk({ account, weights }),
    ),
    ...store.settlements.map((settlement) =>
      predictSettlementOverdueRisk({ settlement, weights }),
    ),
  ].sort((a, b) => b.riskScoreBps - a.riskScoreBps);

  const alerts = predictions.filter((prediction) => prediction.level !== "low");

  const facts: AgentOutput["facts"] = predictions.map((prediction) => ({
    statement: `${XINGYAO_RISK_MODEL_LABELS[prediction.model]}：${
      prediction.objectName
    } 风险分 ${prediction.riskScoreBps} bps`,
    sourceTool: SOURCE_TOOL,
    sourceId: `${prediction.model}:${prediction.objectId}`,
  }));

  const findings: AgentOutput["findings"] = [];
  const recommendations: AgentOutput["recommendations"] = [];
  const alertedModels = new Set<XingyaoRiskModel>();

  for (const alert of alerts) {
    if (alertedModels.has(alert.model)) continue;
    alertedModels.add(alert.model);
    const sameModelAlerts = alerts.filter((item) => item.model === alert.model);
    findings.push({
      summary: `「${XINGYAO_RISK_MODEL_LABELS[alert.model]}」出现中高风险对象，需要提前介入`,
      evidence: sameModelAlerts.slice(0, 5).map((item) => ({
        sourceTool: SOURCE_TOOL,
        sourceId: `${item.model}:${item.objectId}`,
      })),
    });
    recommendations.push({
      proposal: MODEL_ALERT_RECOMMENDATIONS[alert.model],
      expectedImpact: "在风险落地前完成干预，降低损失概率",
      requiresHumanApproval: true,
    });
  }

  if (alerts.length === 0 && facts.length > 0) {
    findings.push({
      summary: "四类风险模型均未出现中高风险对象，整体处于安全水位",
      evidence: [
        {
          sourceTool: SOURCE_TOOL,
          sourceId: `${predictions[0].model}:${predictions[0].objectId}`,
        },
      ],
    });
    recommendations.push({
      proposal: "维持当前监控频率，按周复扫风险雷达",
      expectedImpact: "保持风险前瞻可见性",
      requiresHumanApproval: true,
    });
  }

  const output: AgentOutput = {
    facts,
    findings,
    caveats: [
      {
        summary: "预测基于历史留痕数据外推，平台政策突变等外部因素无法覆盖",
        unverifiedExternalFactor: true,
      },
    ],
    recommendations,
  };

  return {
    predictions,
    alerts,
    output,
    validation: validateAgentOutput(output),
  };
}
