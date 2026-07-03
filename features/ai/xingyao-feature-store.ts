// 星耀 AI 助手 · 统一业务特征库（L1 感知）。
// 打通项目、主播、账号、结算、知识库、录屏六个模块的快照数据，构建
// 人（主播）/ 场（开播执行与时段）/ 货（账号与投放）/ 效（财务与回款）
// 全维度的派生特征，供归因引擎、风险雷达与自然语言诊断复用。
// 本模块是纯函数：原始切片由 loader / 路由层注入（RLS 已在读取侧生效），
// 特征库本身不触库、不调用模型（与 profile-tools 的确定性约定一致）。

export const BPS_FLAT = 10_000;

// 组织默认经营基准：ROI 目标 1.2（12000 bps）、开播率 / 上播率目标 90%。
export const DEFAULT_TARGET_ROI_BPS = 12_000;
export const BROADCAST_RATE_TARGET_BPS = 9_000;
export const SHOW_RATE_TARGET_BPS = 9_000;

export type XingyaoProjectSlice = {
  id: string;
  name: string;
  status: string;
  targetRoiBps?: number;
  monthlyTargetRevenueCents?: number;
  receivableCents: number;
  previousReceivableCents: number;
  payableCents: number;
  paidTrafficCostCents: number;
  otherCostCents: number;
  scheduledSessions: number;
  startedSessions: number;
  greenEvidenceSessions: number;
  viewership: number;
  previousViewership: number;
  conversionGmvCents: number;
  previousConversionGmvCents: number;
  streamerIds: string[];
  accountIds: string[];
};

export type XingyaoStreamerSlice = {
  id: string;
  name: string;
  projectIds: string[];
  scheduledSessions: number;
  startedSessions: number;
  previousScheduledSessions: number;
  previousStartedSessions: number;
  // 排班合理性信号：排进主播不可用时段的场次、日均排班强度。
  availabilityMismatchSessions: number;
  avgDailyScheduledMinutes: number;
  testPassed: boolean;
  trainingCompletedRatioBps: number;
  absenceCount30d: number;
  consecutiveAbsences: number;
  // 历史缺勤日期（ISO date），用于识别「总在同一星期几缺勤」的规律。
  recentAbsenceDates: string[];
  viewership: number;
  conversionGmvCents: number;
  previousConversionGmvCents: number;
  incomeCents: number;
  previousIncomeCents: number;
  disputeCount: number;
  daysSinceLastLive: number;
};

export type XingyaoAccountStatus = "active" | "idle" | "frozen" | "retired";

export type XingyaoAccountSlice = {
  id: string;
  platform: string;
  handle: string;
  status: XingyaoAccountStatus;
  projectIds: string[];
  boundStreamerId?: string;
  viewership: number;
  previousViewership: number;
  violationCount90d: number;
  recentViolationCount30d: number;
  avgDailyLiveMinutes: number;
  peakDailyLiveMinutes: number;
  followerCount: number;
};

export type XingyaoSettlementSlice = {
  id: string;
  projectId?: string;
  counterparty: string;
  amountCents: number;
  // 约定账期剩余天数；负数表示已逾期的天数。
  dueInDays: number;
  counterpartyPastOverdueRateBps: number;
  disputed: boolean;
};

export type XingyaoTimeslotSlice = {
  projectId: string;
  hourOfDay: number;
  scheduledSessions: number;
  startedSessions: number;
  viewership: number;
  previousViewership: number;
  conversionGmvCents: number;
};

export type XingyaoKnowledgeSlice = {
  documentCount: number;
  playbookCount: number;
};

export type XingyaoRecordingSlice = {
  analysisCount: number;
  highRiskCount: number;
  riskFlags: string[];
};

export type XingyaoFeatureStoreInput = {
  organizationId: string;
  periodLabel: string;
  generatedAt: string;
  // 当期已经历的时间占比（bps），用于月度达标进度预测。
  periodElapsedRatioBps: number;
  organizationTargetRoiBps?: number;
  projects: XingyaoProjectSlice[];
  streamers: XingyaoStreamerSlice[];
  accounts: XingyaoAccountSlice[];
  settlements: XingyaoSettlementSlice[];
  timeslots: XingyaoTimeslotSlice[];
  knowledge?: XingyaoKnowledgeSlice;
  recordings?: XingyaoRecordingSlice;
};

export type XingyaoProjectFeature = XingyaoProjectSlice & {
  totalCostCents: number;
  roiBps: number;
  targetRoiBpsResolved: number;
  roiGapBps: number;
  broadcastRateBps: number;
  greenEvidenceRateBps: number;
  trafficTrendBps: number;
  revenueTrendBps: number;
  conversionCentsPerThousandViews: number;
  conversionTrendBps: number;
  paidCostShareBps: number;
};

export type XingyaoStreamerFeature = XingyaoStreamerSlice & {
  showRateBps: number;
  previousShowRateBps: number;
  showRateTrendBps: number;
  scheduleMismatchRateBps: number;
  conversionCentsPerThousandViews: number;
  conversionTrendBps: number;
  incomeTrendBps: number;
  // 重复缺勤的星期（0=周日…6=周六）；同一星期几缺勤不少于两次才算规律。
  absenceWeekdayPattern: number | null;
};

export type XingyaoAccountFeature = XingyaoAccountSlice & {
  trafficTrendBps: number;
  violationDensityBps: number;
  liveHoursSpikeBps: number;
};

export type XingyaoSettlementFeature = XingyaoSettlementSlice & {
  overdueDays: number;
  amountShareBps: number;
};

export type XingyaoTimeslotFeature = XingyaoTimeslotSlice & {
  startRateBps: number;
  trafficTrendBps: number;
};

export type XingyaoBenchmarks = {
  organizationTargetRoiBps: number;
  medianBroadcastRateBps: number;
  medianShowRateBps: number;
  medianConversionCentsPerThousandViews: number;
};

export type XingyaoModuleCoverage = {
  module:
    | "projects"
    | "streamers"
    | "accounts"
    | "settlements"
    | "timeslots"
    | "knowledge"
    | "recordings";
  available: boolean;
};

export type XingyaoFeatureStore = {
  organizationId: string;
  periodLabel: string;
  generatedAt: string;
  periodElapsedRatioBps: number;
  projects: XingyaoProjectFeature[];
  streamers: XingyaoStreamerFeature[];
  accounts: XingyaoAccountFeature[];
  settlements: XingyaoSettlementFeature[];
  timeslots: XingyaoTimeslotFeature[];
  knowledge: XingyaoKnowledgeSlice;
  recordings: XingyaoRecordingSlice;
  benchmarks: XingyaoBenchmarks;
  coverage: XingyaoModuleCoverage[];
  missingData: string[];
};

export function clampBps(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(BPS_FLAT, Math.max(0, Math.round(value)));
}

// 比率（bps）：分母缺失时返回 0，避免除零污染特征。
export function rateBps(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  if (denominator <= 0) return 0;
  return clampBps((numerator / denominator) * BPS_FLAT);
}

// 环比趋势（bps）：10000 = 持平；无基期数据时视为持平，不制造虚假下滑。
export function trendBps(current: number, previous: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return BPS_FLAT;
  if (previous <= 0) return BPS_FLAT;
  const ratio = Math.round((current / previous) * BPS_FLAT);
  return Math.max(0, ratio);
}

function median(values: number[]): number {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function perThousandViews(gmvCents: number, viewership: number): number {
  if (viewership <= 0) return 0;
  return Math.round((gmvCents / viewership) * 1000);
}

function buildProjectFeature(
  slice: XingyaoProjectSlice,
  organizationTargetRoiBps: number,
): XingyaoProjectFeature {
  const totalCostCents =
    slice.payableCents + slice.paidTrafficCostCents + slice.otherCostCents;
  const roiBps =
    totalCostCents > 0
      ? Math.max(
          0,
          Math.round((slice.receivableCents / totalCostCents) * BPS_FLAT),
        )
      : 0;
  const targetRoiBpsResolved = slice.targetRoiBps ?? organizationTargetRoiBps;
  return {
    ...slice,
    totalCostCents,
    roiBps,
    targetRoiBpsResolved,
    roiGapBps: Math.max(0, targetRoiBpsResolved - roiBps),
    broadcastRateBps: rateBps(slice.startedSessions, slice.scheduledSessions),
    greenEvidenceRateBps: rateBps(
      slice.greenEvidenceSessions,
      slice.startedSessions,
    ),
    trafficTrendBps: trendBps(slice.viewership, slice.previousViewership),
    revenueTrendBps: trendBps(
      slice.receivableCents,
      slice.previousReceivableCents,
    ),
    conversionCentsPerThousandViews: perThousandViews(
      slice.conversionGmvCents,
      slice.viewership,
    ),
    conversionTrendBps: trendBps(
      slice.conversionGmvCents,
      slice.previousConversionGmvCents,
    ),
    paidCostShareBps: rateBps(slice.paidTrafficCostCents, totalCostCents),
  };
}

function absenceWeekdayPattern(dates: string[]): number | null {
  const counts = new Map<number, number>();
  for (const raw of dates) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) continue;
    const weekday = parsed.getUTCDay();
    counts.set(weekday, (counts.get(weekday) ?? 0) + 1);
  }
  let pattern: number | null = null;
  let best = 1;
  for (const [weekday, count] of [...counts.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    if (count > best) {
      best = count;
      pattern = weekday;
    }
  }
  return pattern;
}

function buildStreamerFeature(
  slice: XingyaoStreamerSlice,
): XingyaoStreamerFeature {
  return {
    ...slice,
    showRateBps: rateBps(slice.startedSessions, slice.scheduledSessions),
    previousShowRateBps: rateBps(
      slice.previousStartedSessions,
      slice.previousScheduledSessions,
    ),
    showRateTrendBps: trendBps(
      rateBps(slice.startedSessions, slice.scheduledSessions),
      rateBps(slice.previousStartedSessions, slice.previousScheduledSessions),
    ),
    scheduleMismatchRateBps: rateBps(
      slice.availabilityMismatchSessions,
      slice.scheduledSessions,
    ),
    conversionCentsPerThousandViews: perThousandViews(
      slice.conversionGmvCents,
      slice.viewership,
    ),
    conversionTrendBps: trendBps(
      slice.conversionGmvCents,
      slice.previousConversionGmvCents,
    ),
    incomeTrendBps: trendBps(slice.incomeCents, slice.previousIncomeCents),
    absenceWeekdayPattern: absenceWeekdayPattern(slice.recentAbsenceDates),
  };
}

function buildAccountFeature(
  slice: XingyaoAccountSlice,
): XingyaoAccountFeature {
  const olderViolations = Math.max(
    0,
    slice.violationCount90d - slice.recentViolationCount30d,
  );
  return {
    ...slice,
    trafficTrendBps: trendBps(slice.viewership, slice.previousViewership),
    violationDensityBps: clampBps(
      slice.recentViolationCount30d * 3_000 + olderViolations * 1_000,
    ),
    liveHoursSpikeBps: clampBps(
      trendBps(slice.peakDailyLiveMinutes, slice.avgDailyLiveMinutes) - 15_000,
    ),
  };
}

function buildSettlementFeatures(
  slices: XingyaoSettlementSlice[],
): XingyaoSettlementFeature[] {
  const totalAmountCents = slices.reduce(
    (sum, slice) => sum + Math.max(0, slice.amountCents),
    0,
  );
  return slices.map((slice) => ({
    ...slice,
    overdueDays: Math.max(0, -slice.dueInDays),
    amountShareBps: rateBps(Math.max(0, slice.amountCents), totalAmountCents),
  }));
}

function buildTimeslotFeature(
  slice: XingyaoTimeslotSlice,
): XingyaoTimeslotFeature {
  return {
    ...slice,
    startRateBps: rateBps(slice.startedSessions, slice.scheduledSessions),
    trafficTrendBps: trendBps(slice.viewership, slice.previousViewership),
  };
}

const EMPTY_KNOWLEDGE: XingyaoKnowledgeSlice = {
  documentCount: 0,
  playbookCount: 0,
};

const EMPTY_RECORDINGS: XingyaoRecordingSlice = {
  analysisCount: 0,
  highRiskCount: 0,
  riskFlags: [],
};

export function buildXingyaoFeatureStore(
  input: XingyaoFeatureStoreInput,
): XingyaoFeatureStore {
  const organizationTargetRoiBps =
    input.organizationTargetRoiBps ?? DEFAULT_TARGET_ROI_BPS;
  const projects = input.projects.map((slice) =>
    buildProjectFeature(slice, organizationTargetRoiBps),
  );
  const streamers = input.streamers.map(buildStreamerFeature);
  const accounts = input.accounts.map(buildAccountFeature);
  const settlements = buildSettlementFeatures(input.settlements);
  const timeslots = input.timeslots.map(buildTimeslotFeature);
  const knowledge = input.knowledge ?? EMPTY_KNOWLEDGE;
  const recordings = input.recordings ?? EMPTY_RECORDINGS;

  const benchmarks: XingyaoBenchmarks = {
    organizationTargetRoiBps,
    medianBroadcastRateBps: median(
      projects
        .filter((project) => project.scheduledSessions > 0)
        .map((project) => project.broadcastRateBps),
    ),
    medianShowRateBps: median(
      streamers
        .filter((streamer) => streamer.scheduledSessions > 0)
        .map((streamer) => streamer.showRateBps),
    ),
    medianConversionCentsPerThousandViews: median(
      streamers
        .filter((streamer) => streamer.viewership > 0)
        .map((streamer) => streamer.conversionCentsPerThousandViews),
    ),
  };

  const coverage: XingyaoModuleCoverage[] = [
    { module: "projects", available: projects.length > 0 },
    { module: "streamers", available: streamers.length > 0 },
    { module: "accounts", available: accounts.length > 0 },
    { module: "settlements", available: settlements.length > 0 },
    { module: "timeslots", available: timeslots.length > 0 },
    { module: "knowledge", available: knowledge.documentCount > 0 },
    { module: "recordings", available: recordings.analysisCount > 0 },
  ];

  const moduleLabels: Record<XingyaoModuleCoverage["module"], string> = {
    projects: "项目经营数据",
    streamers: "主播执行数据",
    accounts: "账号库数据",
    settlements: "结算回款数据",
    timeslots: "分时段执行数据",
    knowledge: "知识库沉淀",
    recordings: "录屏 AI 分析",
  };
  const missingData = coverage
    .filter((item) => !item.available)
    .map((item) => `${moduleLabels[item.module]}暂无可用快照`);

  return {
    organizationId: input.organizationId,
    periodLabel: input.periodLabel,
    generatedAt: input.generatedAt,
    periodElapsedRatioBps: clampBps(input.periodElapsedRatioBps),
    projects,
    streamers,
    accounts,
    settlements,
    timeslots,
    knowledge,
    recordings,
    benchmarks,
    coverage,
    missingData,
  };
}

export function findXingyaoProject(
  store: XingyaoFeatureStore,
  projectId: string,
): XingyaoProjectFeature | null {
  return store.projects.find((project) => project.id === projectId) ?? null;
}

export function findXingyaoStreamer(
  store: XingyaoFeatureStore,
  streamerId: string,
): XingyaoStreamerFeature | null {
  return store.streamers.find((streamer) => streamer.id === streamerId) ?? null;
}
