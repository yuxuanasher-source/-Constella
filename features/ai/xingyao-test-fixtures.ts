// 星耀模块的共享测试夹具：一个「ROI 不达标 + 上播率偏低 + 账号异常 +
// 回款逾期」的组织快照，供特征库 / 归因 / 风险雷达 / 助手测试复用。
// 仅测试使用，不进入运行时代码路径。

import type {
  XingyaoFeatureStoreInput,
  XingyaoProjectSlice,
  XingyaoStreamerSlice,
} from "./xingyao-feature-store";

export function createProjectSlice(
  overrides: Partial<XingyaoProjectSlice> = {},
): XingyaoProjectSlice {
  return {
    id: "p-1",
    name: "天使之战",
    status: "recruiting",
    receivableCents: 500_000,
    previousReceivableCents: 600_000,
    payableCents: 400_000,
    paidTrafficCostCents: 80_000,
    otherCostCents: 20_000,
    scheduledSessions: 20,
    startedSessions: 12,
    greenEvidenceSessions: 10,
    viewership: 8_000,
    previousViewership: 10_000,
    conversionGmvCents: 200_000,
    previousConversionGmvCents: 260_000,
    streamerIds: ["s-1"],
    accountIds: ["a-1"],
    ...overrides,
  };
}

export function createStreamerSlice(
  overrides: Partial<XingyaoStreamerSlice> = {},
): XingyaoStreamerSlice {
  return {
    id: "s-1",
    name: "小美",
    projectIds: ["p-1"],
    scheduledSessions: 10,
    startedSessions: 5,
    previousScheduledSessions: 10,
    previousStartedSessions: 9,
    availabilityMismatchSessions: 2,
    avgDailyScheduledMinutes: 300,
    testPassed: false,
    trainingCompletedRatioBps: 4_000,
    absenceCount30d: 2,
    consecutiveAbsences: 2,
    recentAbsenceDates: ["2026-06-24", "2026-07-01"],
    viewership: 4_000,
    conversionGmvCents: 40_000,
    previousConversionGmvCents: 80_000,
    incomeCents: 100_000,
    previousIncomeCents: 200_000,
    disputeCount: 1,
    daysSinceLastLive: 4,
    ...overrides,
  };
}

export function createInput(
  overrides: Partial<XingyaoFeatureStoreInput> = {},
): XingyaoFeatureStoreInput {
  return {
    organizationId: "org-1",
    periodLabel: "2026-07",
    generatedAt: "2026-07-03T10:00:00+08:00",
    periodElapsedRatioBps: 1_000,
    projects: [createProjectSlice()],
    streamers: [createStreamerSlice()],
    accounts: [
      {
        id: "a-1",
        platform: "douyin",
        handle: "uid-001",
        status: "active",
        projectIds: ["p-1"],
        boundStreamerId: "s-1",
        viewership: 5_000,
        previousViewership: 9_000,
        violationCount90d: 3,
        recentViolationCount30d: 2,
        avgDailyLiveMinutes: 200,
        peakDailyLiveMinutes: 600,
        followerCount: 12_000,
      },
    ],
    settlements: [
      {
        id: "b-1",
        projectId: "p-1",
        counterparty: "厂家甲",
        amountCents: 300_000,
        dueInDays: -5,
        counterpartyPastOverdueRateBps: 4_000,
        disputed: false,
      },
    ],
    timeslots: [
      {
        projectId: "p-1",
        hourOfDay: 20,
        scheduledSessions: 6,
        startedSessions: 3,
        viewership: 3_000,
        previousViewership: 6_000,
        conversionGmvCents: 60_000,
      },
    ],
    knowledge: { documentCount: 3, playbookCount: 1 },
    recordings: {
      analysisCount: 2,
      highRiskCount: 1,
      riskFlags: ["verbal_violation"],
    },
    ...overrides,
  };
}
