// 星耀 AI 助手 · 卡点自动定位与归因引擎（L1 感知）。
// 输入统一业务特征库，输出确定性的归因报告：
// - 项目 ROI 不达标 → 拆解「开播率不足 / 账号流量下滑 / 主播转化能力弱 /
//   投放策略问题」四环，并定位到具体主播、具体账号、具体时段；
// - 主播上播率低 → 关联排班合理性、测试通过率、培训完成度、历史缺勤规律。
// 数字只允许出现在 facts 中；findings / recommendations 全部定性描述，
// 由 agent-output-contract 校验兜底（与既有 agent 完全同构）。

import type { AgentOutput } from "./contracts";
import { validateAgentOutput } from "./agent-output-contract";
import {
  BROADCAST_RATE_TARGET_BPS,
  SHOW_RATE_TARGET_BPS,
  BPS_FLAT,
  clampBps,
  findXingyaoProject,
  findXingyaoStreamer,
  type XingyaoFeatureStore,
  type XingyaoProjectFeature,
  type XingyaoStreamerFeature,
} from "./xingyao-feature-store";

const SOURCE_TOOL = "xingyao_feature_store";

// 投放成本占比超过该阈值且 ROI 不达标时，投放策略进入归因候选。
const HEALTHY_PAID_COST_SHARE_BPS = 3_000;

export type XingyaoOffender = {
  kind: "streamer" | "account" | "timeslot";
  id: string;
  name: string;
  metric: string;
  metricValueBps: number;
};

export type XingyaoRoiCauseKey =
  | "broadcast_shortfall"
  | "account_traffic_decline"
  | "weak_conversion"
  | "paid_traffic_strategy";

export const XINGYAO_ROI_CAUSE_LABELS: Record<XingyaoRoiCauseKey, string> = {
  broadcast_shortfall: "开播率不足",
  account_traffic_decline: "账号流量下滑",
  weak_conversion: "主播转化能力弱",
  paid_traffic_strategy: "投放策略问题",
};

export type XingyaoRoiCause = {
  key: XingyaoRoiCauseKey;
  label: string;
  scoreBps: number;
  offenders: XingyaoOffender[];
};

export type XingyaoRoiAttribution = {
  projectId: string;
  projectName: string;
  roiBps: number;
  targetRoiBps: number;
  roiGapBps: number;
  healthy: boolean;
  causes: XingyaoRoiCause[];
  primaryCause: XingyaoRoiCauseKey | null;
};

function projectStreamers(
  store: XingyaoFeatureStore,
  project: XingyaoProjectFeature,
): XingyaoStreamerFeature[] {
  const ids = new Set(project.streamerIds);
  return store.streamers.filter(
    (streamer) =>
      ids.has(streamer.id) || streamer.projectIds.includes(project.id),
  );
}

function lowShowRateOffenders(
  store: XingyaoFeatureStore,
  project: XingyaoProjectFeature,
): XingyaoOffender[] {
  return projectStreamers(store, project)
    .filter(
      (streamer) =>
        streamer.scheduledSessions > 0 &&
        streamer.showRateBps < SHOW_RATE_TARGET_BPS,
    )
    .sort((a, b) => a.showRateBps - b.showRateBps)
    .slice(0, 3)
    .map((streamer) => ({
      kind: "streamer" as const,
      id: streamer.id,
      name: streamer.name,
      metric: "showRateBps",
      metricValueBps: streamer.showRateBps,
    }));
}

function decliningAccountOffenders(
  store: XingyaoFeatureStore,
  project: XingyaoProjectFeature,
): XingyaoOffender[] {
  const ids = new Set(project.accountIds);
  return store.accounts
    .filter(
      (account) =>
        (ids.has(account.id) || account.projectIds.includes(project.id)) &&
        account.trafficTrendBps < BPS_FLAT,
    )
    .sort((a, b) => a.trafficTrendBps - b.trafficTrendBps)
    .slice(0, 3)
    .map((account) => ({
      kind: "account" as const,
      id: account.id,
      name: `${account.platform}:${account.handle}`,
      metric: "trafficTrendBps",
      metricValueBps: account.trafficTrendBps,
    }));
}

function weakConversionOffenders(
  store: XingyaoFeatureStore,
  project: XingyaoProjectFeature,
): XingyaoOffender[] {
  const benchmark = store.benchmarks.medianConversionCentsPerThousandViews;
  if (benchmark <= 0) return [];
  return projectStreamers(store, project)
    .filter(
      (streamer) =>
        streamer.viewership > 0 &&
        streamer.conversionCentsPerThousandViews < benchmark,
    )
    .sort(
      (a, b) =>
        a.conversionCentsPerThousandViews - b.conversionCentsPerThousandViews,
    )
    .slice(0, 3)
    .map((streamer) => ({
      kind: "streamer" as const,
      id: streamer.id,
      name: streamer.name,
      metric: "conversionCentsPerThousandViews",
      metricValueBps: streamer.conversionCentsPerThousandViews,
    }));
}

function timeslotOffenders(
  store: XingyaoFeatureStore,
  project: XingyaoProjectFeature,
  metric: "startRateBps" | "trafficTrendBps",
): XingyaoOffender[] {
  const threshold =
    metric === "startRateBps" ? BROADCAST_RATE_TARGET_BPS : BPS_FLAT;
  return store.timeslots
    .filter(
      (slot) =>
        slot.projectId === project.id &&
        slot.scheduledSessions > 0 &&
        slot[metric] < threshold,
    )
    .sort((a, b) => a[metric] - b[metric])
    .slice(0, 3)
    .map((slot) => ({
      kind: "timeslot" as const,
      id: `${slot.projectId}:${slot.hourOfDay}`,
      name: `${String(slot.hourOfDay).padStart(2, "0")}:00 时段`,
      metric,
      metricValueBps: slot[metric],
    }));
}

// ROI 缺口四环拆解。各环得分统一映射到 0-10000 的严重度，便于排序与横向比较。
export function attributeProjectRoiGap({
  store,
  projectId,
}: {
  store: XingyaoFeatureStore;
  projectId: string;
}): XingyaoRoiAttribution | null {
  const project = findXingyaoProject(store, projectId);
  if (!project) return null;

  const healthy = project.roiGapBps <= 0;

  const broadcastScore = clampBps(
    ((BROADCAST_RATE_TARGET_BPS - project.broadcastRateBps) /
      BROADCAST_RATE_TARGET_BPS) *
      BPS_FLAT,
  );
  const trafficScore = clampBps(BPS_FLAT - project.trafficTrendBps);
  const benchmarkConversion =
    store.benchmarks.medianConversionCentsPerThousandViews;
  const conversionScore =
    benchmarkConversion > 0
      ? clampBps(
          ((benchmarkConversion - project.conversionCentsPerThousandViews) /
            benchmarkConversion) *
            BPS_FLAT,
        )
      : clampBps(BPS_FLAT - project.conversionTrendBps);
  const paidScore = healthy
    ? 0
    : clampBps((project.paidCostShareBps - HEALTHY_PAID_COST_SHARE_BPS) * 2);

  const unsortedCauses: XingyaoRoiCause[] = [
    {
      key: "broadcast_shortfall",
      label: XINGYAO_ROI_CAUSE_LABELS.broadcast_shortfall,
      scoreBps: broadcastScore,
      offenders: [
        ...lowShowRateOffenders(store, project),
        ...timeslotOffenders(store, project, "startRateBps"),
      ],
    },
    {
      key: "account_traffic_decline",
      label: XINGYAO_ROI_CAUSE_LABELS.account_traffic_decline,
      scoreBps: trafficScore,
      offenders: [
        ...decliningAccountOffenders(store, project),
        ...timeslotOffenders(store, project, "trafficTrendBps"),
      ],
    },
    {
      key: "weak_conversion",
      label: XINGYAO_ROI_CAUSE_LABELS.weak_conversion,
      scoreBps: conversionScore,
      offenders: weakConversionOffenders(store, project),
    },
    {
      key: "paid_traffic_strategy",
      label: XINGYAO_ROI_CAUSE_LABELS.paid_traffic_strategy,
      scoreBps: paidScore,
      offenders: [],
    },
  ];
  const causes = unsortedCauses.sort((a, b) => b.scoreBps - a.scoreBps);

  const primary = causes.find((cause) => cause.scoreBps > 0) ?? null;

  return {
    projectId: project.id,
    projectName: project.name,
    roiBps: project.roiBps,
    targetRoiBps: project.targetRoiBpsResolved,
    roiGapBps: project.roiGapBps,
    healthy,
    causes,
    primaryCause: healthy ? null : (primary?.key ?? null),
  };
}

export type XingyaoShowRateCauseKey =
  | "schedule_mismatch"
  | "admission_test_gap"
  | "training_gap"
  | "absence_pattern";

export const XINGYAO_SHOW_RATE_CAUSE_LABELS: Record<
  XingyaoShowRateCauseKey,
  string
> = {
  schedule_mismatch: "排班合理性存疑",
  admission_test_gap: "测试未通过",
  training_gap: "培训未完成",
  absence_pattern: "历史缺勤规律",
};

export type XingyaoShowRateCause = {
  key: XingyaoShowRateCauseKey;
  label: string;
  scoreBps: number;
  detail: string;
};

export type XingyaoShowRateAttribution = {
  streamerId: string;
  streamerName: string;
  showRateBps: number;
  showRateTrendBps: number;
  healthy: boolean;
  causes: XingyaoShowRateCause[];
  primaryCause: XingyaoShowRateCauseKey | null;
};

// 每日排班超过 8 小时视为过载，计入排班合理性。
const OVERLOAD_MINUTES_PER_DAY = 480;

const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function attributeStreamerShowRate({
  store,
  streamerId,
}: {
  store: XingyaoFeatureStore;
  streamerId: string;
}): XingyaoShowRateAttribution | null {
  const streamer = findXingyaoStreamer(store, streamerId);
  if (!streamer) return null;

  const healthy =
    streamer.scheduledSessions === 0 ||
    streamer.showRateBps >= SHOW_RATE_TARGET_BPS;

  const overloadScore = clampBps(
    ((streamer.avgDailyScheduledMinutes - OVERLOAD_MINUTES_PER_DAY) /
      OVERLOAD_MINUTES_PER_DAY) *
      BPS_FLAT,
  );
  const scheduleScore = Math.max(
    streamer.scheduleMismatchRateBps,
    overloadScore,
  );
  const testScore = streamer.testPassed ? 0 : 8_000;
  const trainingScore = clampBps(BPS_FLAT - streamer.trainingCompletedRatioBps);
  const absenceScore = clampBps(
    streamer.absenceCount30d * 1_500 +
      streamer.consecutiveAbsences * 2_000 +
      (streamer.absenceWeekdayPattern !== null ? 1_500 : 0),
  );

  const unsortedCauses: XingyaoShowRateCause[] = [
    {
      key: "schedule_mismatch",
      label: XINGYAO_SHOW_RATE_CAUSE_LABELS.schedule_mismatch,
      scoreBps: scheduleScore,
      detail:
        streamer.scheduleMismatchRateBps >= overloadScore
          ? "存在排进主播不可用时段的场次，建议核对可用时段后再排班"
          : "日均排班强度偏高，可能超出主播可持续负荷",
    },
    {
      key: "admission_test_gap",
      label: XINGYAO_SHOW_RATE_CAUSE_LABELS.admission_test_gap,
      scoreBps: testScore,
      detail: streamer.testPassed
        ? "试播测试已通过"
        : "试播测试未通过，准入环节存在缺口",
    },
    {
      key: "training_gap",
      label: XINGYAO_SHOW_RATE_CAUSE_LABELS.training_gap,
      scoreBps: trainingScore,
      detail:
        trainingScore > 0
          ? "培训完成度未达标，上播规范可能未掌握"
          : "培训已完成",
    },
    {
      key: "absence_pattern",
      label: XINGYAO_SHOW_RATE_CAUSE_LABELS.absence_pattern,
      scoreBps: absenceScore,
      detail:
        streamer.absenceWeekdayPattern !== null
          ? `缺勤集中在${WEEKDAY_CN[streamer.absenceWeekdayPattern]}，呈现规律性`
          : absenceScore > 0
            ? "近期存在缺勤记录，尚未形成固定规律"
            : "近期无缺勤记录",
    },
  ];
  const causes = unsortedCauses.sort((a, b) => b.scoreBps - a.scoreBps);

  const primary = causes.find((cause) => cause.scoreBps > 0) ?? null;

  return {
    streamerId: streamer.id,
    streamerName: streamer.name,
    showRateBps: streamer.showRateBps,
    showRateTrendBps: streamer.showRateTrendBps,
    healthy,
    causes,
    primaryCause: healthy ? null : (primary?.key ?? null),
  };
}

type SourceRef = { sourceTool: string; sourceId: string };

function source(sourceId: string): SourceRef {
  return { sourceTool: SOURCE_TOOL, sourceId };
}

function offenderStatement(offender: XingyaoOffender): string {
  const kindLabel =
    offender.kind === "streamer"
      ? "主播"
      : offender.kind === "account"
        ? "账号"
        : "时段";
  return `${kindLabel} ${offender.name} 的 ${offender.metric} 为 ${offender.metricValueBps}`;
}

const ROI_CAUSE_RECOMMENDATIONS: Record<XingyaoRoiCauseKey, string> = {
  broadcast_shortfall:
    "优先补齐开播缺口：核对低上播主播的排班与到岗承诺，必要时启动替补主播",
  account_traffic_decline:
    "排查流量下滑账号的内容与限流状态，评估换号或调整开播时段",
  weak_conversion: "针对转化偏弱的主播安排话术复训，并复用高转化主播的脚本沉淀",
  paid_traffic_strategy: "复核投放计划的量价配比，暂停低效投放并重新分配预算",
};

export type XingyaoRoiAttributionAgentResult = {
  attribution: XingyaoRoiAttribution;
  output: AgentOutput;
  validation: ReturnType<typeof validateAgentOutput>;
};

export function buildRoiAttributionAgentOutput(
  attribution: XingyaoRoiAttribution,
): XingyaoRoiAttributionAgentResult {
  const prefix = attribution.projectId;
  const facts: AgentOutput["facts"] = [
    {
      statement: `项目 ${attribution.projectName} 当期 ROI 为 ${attribution.roiBps} bps`,
      ...source(`${prefix}:roiBps`),
    },
    {
      statement: `项目 ${attribution.projectName} 的 ROI 目标为 ${attribution.targetRoiBps} bps`,
      ...source(`${prefix}:targetRoiBps`),
    },
    {
      statement: `项目 ${attribution.projectName} 的 ROI 缺口为 ${attribution.roiGapBps} bps`,
      ...source(`${prefix}:roiGapBps`),
    },
  ];

  for (const cause of attribution.causes) {
    facts.push({
      statement: `归因环「${cause.label}」严重度为 ${cause.scoreBps} bps`,
      ...source(`${prefix}:cause:${cause.key}`),
    });
    for (const offender of cause.offenders) {
      facts.push({
        statement: offenderStatement(offender),
        ...source(
          `${prefix}:cause:${cause.key}:${offender.kind}:${offender.id}`,
        ),
      });
    }
  }

  const findings: AgentOutput["findings"] = [];
  const recommendations: AgentOutput["recommendations"] = [];

  if (attribution.healthy) {
    findings.push({
      summary: "项目 ROI 达标，暂无需要处理的核心卡点",
      evidence: [source(`${prefix}:roiBps`), source(`${prefix}:targetRoiBps`)],
    });
    recommendations.push({
      proposal: "保持当前运营策略，按周继续跟踪各环严重度变化",
      expectedImpact: "在不增加投入的情况下守住达标水位",
      requiresHumanApproval: true,
    });
  } else {
    const primary = attribution.causes[0];
    findings.push(
      primary.scoreBps > 0
        ? {
            summary: `项目 ROI 未达标，最主要卡点是「${primary.label}」`,
            evidence: [
              source(`${prefix}:roiGapBps`),
              source(`${prefix}:cause:${primary.key}`),
            ],
          }
        : {
            summary:
              "项目 ROI 未达标，但四环特征均未见显著异常，建议人工深查口径与外部因素",
            evidence: [source(`${prefix}:roiGapBps`)],
          },
    );
    for (const cause of attribution.causes) {
      if (cause.scoreBps <= 0 || cause.offenders.length === 0) continue;
      findings.push({
        summary: `「${cause.label}」已定位到具体对象，建议按清单逐一处理`,
        evidence: [
          source(`${prefix}:cause:${cause.key}`),
          ...cause.offenders.map((offender) =>
            source(
              `${prefix}:cause:${cause.key}:${offender.kind}:${offender.id}`,
            ),
          ),
        ],
      });
    }
    for (const cause of attribution.causes.slice(0, 2)) {
      if (cause.scoreBps <= 0) continue;
      recommendations.push({
        proposal: ROI_CAUSE_RECOMMENDATIONS[cause.key],
        expectedImpact: "收窄该环的严重度并带动 ROI 回升",
        requiresHumanApproval: true,
      });
    }
    if (recommendations.length === 0) {
      recommendations.push({
        proposal: "组织人工复盘核对收入成本口径，并补齐缺失模块的数据接入",
        expectedImpact: "先还原真实缺口，再进入下一轮自动归因",
        requiresHumanApproval: true,
      });
    }
  }

  const output: AgentOutput = {
    facts,
    findings,
    caveats: [
      {
        summary: "平台侧算法调整、行业淡旺季等外部因素未纳入归因",
        unverifiedExternalFactor: true,
      },
    ],
    recommendations,
  };

  return { attribution, output, validation: validateAgentOutput(output) };
}

const SHOW_RATE_CAUSE_RECOMMENDATIONS: Record<XingyaoShowRateCauseKey, string> =
  {
    schedule_mismatch: "按主播可用时段重排档期，并把日均时长压回可持续区间",
    admission_test_gap: "先安排复测并明确通过标准，再恢复正式排班",
    training_gap: "补齐必修培训后再增加排班密度",
    absence_pattern: "与主播确认规律性缺勤原因，评估调整固定档期或启用替补",
  };

export type XingyaoShowRateAttributionAgentResult = {
  attribution: XingyaoShowRateAttribution;
  output: AgentOutput;
  validation: ReturnType<typeof validateAgentOutput>;
};

export function buildShowRateAttributionAgentOutput(
  attribution: XingyaoShowRateAttribution,
): XingyaoShowRateAttributionAgentResult {
  const prefix = attribution.streamerId;
  const facts: AgentOutput["facts"] = [
    {
      statement: `主播 ${attribution.streamerName} 当期上播率为 ${attribution.showRateBps} bps`,
      ...source(`${prefix}:showRateBps`),
    },
    {
      statement: `主播 ${attribution.streamerName} 上播率环比趋势为 ${attribution.showRateTrendBps} bps`,
      ...source(`${prefix}:showRateTrendBps`),
    },
    ...attribution.causes.map((cause) => ({
      statement: `因子「${cause.label}」严重度为 ${cause.scoreBps} bps`,
      ...source(`${prefix}:cause:${cause.key}`),
    })),
  ];

  const findings: AgentOutput["findings"] = [];
  const recommendations: AgentOutput["recommendations"] = [];

  if (attribution.healthy) {
    findings.push({
      summary: "主播上播率健康，无需专项干预",
      evidence: [source(`${prefix}:showRateBps`)],
    });
    recommendations.push({
      proposal: "维持当前排班节奏，按周关注缺勤与培训信号",
      expectedImpact: "保持上播稳定性",
      requiresHumanApproval: true,
    });
  } else {
    const primary = attribution.causes[0];
    findings.push({
      summary: `主播上播率偏低，核心原因指向「${primary.label}」`,
      evidence: [
        source(`${prefix}:showRateBps`),
        source(`${prefix}:cause:${primary.key}`),
      ],
    });
    for (const cause of attribution.causes) {
      if (cause.scoreBps <= 0) continue;
      findings.push({
        summary: `「${cause.label}」：${cause.detail}`,
        evidence: [source(`${prefix}:cause:${cause.key}`)],
      });
      recommendations.push({
        proposal: SHOW_RATE_CAUSE_RECOMMENDATIONS[cause.key],
        expectedImpact: "消除该因子对上播率的拖累",
        requiresHumanApproval: true,
      });
    }
  }

  const output: AgentOutput = {
    facts,
    findings,
    caveats: [
      {
        summary: "主播个人突发状况等外部因素未经核实，归因以系统留痕为准",
        unverifiedExternalFactor: true,
      },
    ],
    recommendations,
  };

  return { attribution, output, validation: validateAgentOutput(output) };
}
