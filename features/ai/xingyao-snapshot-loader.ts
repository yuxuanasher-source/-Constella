// 星耀 AI 助手 · 组织业务快照 loader。
// 把项目、主播、账号、结算、知识库、录屏六个模块的留痕数据（RLS 作用下
// 的组织可见范围）聚合成统一特征库的输入切片。设计原则：
// - 逐模块 best-effort：任一模块查询失败即降级为空切片，绝不让诊断链路
//   因单模块故障而中断（与 dashboard grounding 的降级约定一致）；
// - 财务口径与 role-home-loader 同源：应收 = 审核通过报数的结算时长 ×
//   项目默认时薪；应付 = 结算时长 × 项目内主播时薪；
// - 尚无独立留痕的信号（如培训完成度）用已有数据做显式代理并注明，
//   等专属模块落地后替换，避免凭空编造特征。

import {
  buildXingyaoFeatureStore,
  type XingyaoAccountSlice,
  type XingyaoAccountStatus,
  type XingyaoFeatureStore,
  type XingyaoFeatureStoreInput,
  type XingyaoKnowledgeSlice,
  type XingyaoProjectSlice,
  type XingyaoRecordingSlice,
  type XingyaoSettlementSlice,
  type XingyaoStreamerSlice,
  type XingyaoTimeslotSlice,
} from "./xingyao-feature-store";
import { toCents } from "@/features/billing/hourly-rate-units";

const XINGYAO_TIME_ZONE = "Asia/Shanghai";
const ROW_LIMIT = 2_000;
// 回款账期代理：批次期末后 30 天视为约定回款日（后续可接组织配置）。
const RECEIVABLE_DUE_DAYS_AFTER_PERIOD = 30;
// 培训完成度代理：每一笔无风险报数记 2000 bps，满五笔视为培训达标。
const CLEAN_REPORT_TRAINING_STEP_BPS = 2_000;

type QueryResult = PromiseLike<{
  data: Record<string, unknown>[] | null;
  error: { message?: string } | Error | null;
}>;

type XingyaoQueryBuilder = {
  select(columns: string): XingyaoQueryBuilder;
  eq(column: string, value: unknown): XingyaoQueryBuilder;
  gte(column: string, value: string): XingyaoQueryBuilder;
  limit(count: number): QueryResult;
};

export type XingyaoSnapshotClient = {
  from(table: string): XingyaoQueryBuilder;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateParts(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const [year = "0", month = "0", day = "0"] = value.slice(0, 10).split("-");
    return {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: 0,
    };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const byType = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return {
    year: Number(byType.year ?? 0),
    month: Number(byType.month ?? 0),
    day: Number(byType.day ?? 0),
    hour: Number(byType.hour ?? 0),
  };
}

function localDateKey(value: string): string {
  const parts = localDateParts(value, XINGYAO_TIME_ZONE);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function localHour(value: string): number {
  return localDateParts(value, XINGYAO_TIME_ZONE).hour;
}

type MonthPeriod = {
  label: string;
  startKey: string;
  endKey: string;
};

function monthPeriod(year: number, month: number): MonthPeriod {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    label: `${year}-${pad2(month)}`,
    startKey: `${year}-${pad2(month)}-01`,
    endKey: `${year}-${pad2(month)}-${pad2(lastDay)}`,
  };
}

export function resolveXingyaoPeriods(now: string): {
  current: MonthPeriod;
  previous: MonthPeriod;
  periodElapsedRatioBps: number;
  fetchSince: string;
} {
  const parts = localDateParts(now, XINGYAO_TIME_ZONE);
  const current = monthPeriod(parts.year, parts.month);
  const prevYear = parts.month === 1 ? parts.year - 1 : parts.year;
  const prevMonth = parts.month === 1 ? 12 : parts.month - 1;
  const previous = monthPeriod(prevYear, prevMonth);
  const daysInMonth = new Date(
    Date.UTC(parts.year, parts.month, 0),
  ).getUTCDate();
  return {
    current,
    previous,
    periodElapsedRatioBps: Math.round((parts.day / daysInMonth) * 10_000),
    fetchSince: `${previous.startKey}T00:00:00+08:00`,
  };
}

function inPeriod(dateKey: string, period: MonthPeriod): boolean {
  return dateKey >= period.startKey && dateKey <= period.endKey;
}

async function listRows(
  client: XingyaoSnapshotClient,
  organizationId: string,
  table: string,
  columns: string,
  since?: { column: string; value: string },
): Promise<Record<string, unknown>[]> {
  try {
    let query = client
      .from(table)
      .select(columns)
      .eq("organization_id", organizationId);
    if (since) {
      query = query.gte(since.column, since.value);
    }
    const { data, error } = await query.limit(ROW_LIMIT);
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

type PeriodTotals = { current: number; previous: number };

function totals(): PeriodTotals {
  return { current: 0, previous: 0 };
}

function addToPeriod(
  target: PeriodTotals,
  dateKey: string,
  periods: { current: MonthPeriod; previous: MonthPeriod },
  amount: number,
): void {
  if (inPeriod(dateKey, periods.current)) target.current += amount;
  else if (inPeriod(dateKey, periods.previous)) target.previous += amount;
}

export async function loadXingyaoFeatureStoreInput({
  client,
  organizationId,
  now = new Date().toISOString(),
}: {
  client: XingyaoSnapshotClient;
  organizationId: string;
  now?: string;
}): Promise<XingyaoFeatureStoreInput> {
  const periods = resolveXingyaoPeriods(now);
  const nowKey = localDateKey(now);

  const [
    projectRows,
    taskRows,
    reportRows,
    streamerRows,
    projectStreamerRows,
    accountRows,
    costItemRows,
    batchRows,
    knowledgeRows,
    recordingRows,
  ] = await Promise.all([
    listRows(
      client,
      organizationId,
      "projects",
      "id, name, status, default_hourly_rate",
    ),
    listRows(
      client,
      organizationId,
      "live_tasks",
      "id, project_id, streamer_id, status, planned_start_at, planned_duration, system_started_at",
      { column: "planned_start_at", value: periods.fetchSince },
    ),
    listRows(
      client,
      organizationId,
      "live_reports",
      "id, project_id, streamer_id, status, settlement_duration, evidence_level, viewers, risk_flags, created_at",
      { column: "created_at", value: periods.fetchSince },
    ),
    listRows(
      client,
      organizationId,
      "streamers",
      "id, display_name, auto_trust, clean_report_count",
    ),
    listRows(
      client,
      organizationId,
      "project_streamers",
      "project_id, streamer_id, status, hourly_rate",
    ),
    listRows(
      client,
      organizationId,
      "platform_accounts",
      "id, platform, account_uid, status, bound_streamer_id",
    ),
    listRows(
      client,
      organizationId,
      "project_cost_items",
      "project_id, streamer_id, item_type, amount_cents, direction, status, created_at",
      { column: "created_at", value: periods.fetchSince },
    ),
    listRows(
      client,
      organizationId,
      "settlement_batches",
      "id, project_id, batch_type, status, period_end, computed_amount, manual_amount, adjustment_amount",
    ),
    listRows(client, organizationId, "knowledge_documents", "id, doc_type"),
    listRows(
      client,
      organizationId,
      "recording_ai_analyses",
      "id, status, risk_flags",
    ),
  ]);

  const hourlyRateCentsByProject = new Map<string, number>();
  const projectNameById = new Map<string, string>();
  for (const row of projectRows) {
    const id = str(row.id);
    hourlyRateCentsByProject.set(id, toCents(num(row.default_hourly_rate)));
    projectNameById.set(id, str(row.name));
  }

  // 项目内主播时薪（应付口径）；缺失时退回项目默认时薪。
  const payableRateCents = new Map<string, number>();
  const projectIdsByStreamer = new Map<string, Set<string>>();
  for (const row of projectStreamerRows) {
    const projectId = str(row.project_id);
    const streamerId = str(row.streamer_id);
    const rate =
      row.hourly_rate === null || row.hourly_rate === undefined
        ? (hourlyRateCentsByProject.get(projectId) ?? 0)
        : toCents(num(row.hourly_rate));
    payableRateCents.set(`${projectId}:${streamerId}`, rate);
    if (!projectIdsByStreamer.has(streamerId)) {
      projectIdsByStreamer.set(streamerId, new Set());
    }
    projectIdsByStreamer.get(streamerId)?.add(projectId);
  }

  // —— 报数聚合（效 / 场）——
  const projectReceivable = new Map<string, PeriodTotals>();
  const projectPayable = new Map<string, PeriodTotals>();
  const projectViewers = new Map<string, PeriodTotals>();
  const projectGreenSessions = new Map<string, number>();
  const streamerViewers = new Map<string, number>();
  const streamerIncome = new Map<string, PeriodTotals>();
  const streamerDisputes = new Map<string, number>();

  const ensure = <K, V>(map: Map<K, V>, key: K, init: () => V): V => {
    const existing = map.get(key);
    if (existing !== undefined) return existing;
    const created = init();
    map.set(key, created);
    return created;
  };

  for (const row of reportRows) {
    const projectId = str(row.project_id);
    const streamerId = str(row.streamer_id);
    const dateKey = localDateKey(str(row.created_at));
    const viewers = num(row.viewers);
    addToPeriod(
      ensure(projectViewers, projectId, totals),
      dateKey,
      periods,
      viewers,
    );
    if (inPeriod(dateKey, periods.current)) {
      streamerViewers.set(
        streamerId,
        (streamerViewers.get(streamerId) ?? 0) + viewers,
      );
      if (strArray(row.risk_flags).length > 0) {
        streamerDisputes.set(
          streamerId,
          (streamerDisputes.get(streamerId) ?? 0) + 1,
        );
      }
    }
    if (str(row.status) !== "approved") continue;
    const hours = num(row.settlement_duration) / 60;
    const receivableCents = Math.round(
      hours * (hourlyRateCentsByProject.get(projectId) ?? 0),
    );
    const payableCents = Math.round(
      hours *
        (payableRateCents.get(`${projectId}:${streamerId}`) ??
          hourlyRateCentsByProject.get(projectId) ??
          0),
    );
    addToPeriod(
      ensure(projectReceivable, projectId, totals),
      dateKey,
      periods,
      receivableCents,
    );
    addToPeriod(
      ensure(projectPayable, projectId, totals),
      dateKey,
      periods,
      payableCents,
    );
    addToPeriod(
      ensure(streamerIncome, streamerId, totals),
      dateKey,
      periods,
      payableCents,
    );
    if (
      inPeriod(dateKey, periods.current) &&
      str(row.evidence_level) === "green"
    ) {
      projectGreenSessions.set(
        projectId,
        (projectGreenSessions.get(projectId) ?? 0) + 1,
      );
    }
  }

  // —— 排班 / 开播聚合（场 / 人 / 时段）——
  type SessionCounter = { scheduled: PeriodTotals; started: PeriodTotals };
  const projectSessions = new Map<string, SessionCounter>();
  const streamerSessions = new Map<string, SessionCounter>();
  const streamerPlannedMinutes = new Map<string, number>();
  const streamerMissedDates = new Map<string, string[]>();
  const streamerRecentTasks = new Map<
    string,
    Array<{ dateKey: string; started: boolean }>
  >();
  const streamerLastLiveKey = new Map<string, string>();
  const timeslotMap = new Map<string, XingyaoTimeslotSlice>();

  const sessionCounter = (): SessionCounter => ({
    scheduled: totals(),
    started: totals(),
  });
  const thirtyDaysAgoKey = localDateKey(
    new Date(new Date(now).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  );

  for (const row of taskRows) {
    const status = str(row.status);
    if (status === "cancelled") continue;
    const projectId = str(row.project_id);
    const streamerId = str(row.streamer_id);
    const plannedAt = str(row.planned_start_at);
    if (!plannedAt) continue;
    const dateKey = localDateKey(plannedAt);
    const started = Boolean(row.system_started_at) || status === "live";
    // 未来排班不计入开播率分母。
    const isPastOrToday = dateKey <= nowKey;

    if (isPastOrToday) {
      const projectCounter = ensure(projectSessions, projectId, sessionCounter);
      addToPeriod(projectCounter.scheduled, dateKey, periods, 1);
      if (started) addToPeriod(projectCounter.started, dateKey, periods, 1);

      const streamerCounter = ensure(
        streamerSessions,
        streamerId,
        sessionCounter,
      );
      addToPeriod(streamerCounter.scheduled, dateKey, periods, 1);
      if (started) addToPeriod(streamerCounter.started, dateKey, periods, 1);

      if (inPeriod(dateKey, periods.current)) {
        streamerPlannedMinutes.set(
          streamerId,
          (streamerPlannedMinutes.get(streamerId) ?? 0) +
            num(row.planned_duration),
        );
        const hour = localHour(plannedAt);
        const slotKey = `${projectId}:${hour}`;
        const slot = ensure(timeslotMap, slotKey, () => ({
          projectId,
          hourOfDay: hour,
          scheduledSessions: 0,
          startedSessions: 0,
          viewership: 0,
          previousViewership: 0,
          conversionGmvCents: 0,
        }));
        slot.scheduledSessions += 1;
        if (started) slot.startedSessions += 1;
      }

      if (dateKey >= thirtyDaysAgoKey) {
        ensure(streamerRecentTasks, streamerId, () => []).push({
          dateKey,
          started,
        });
        if (!started) {
          ensure(streamerMissedDates, streamerId, () => []).push(dateKey);
        }
      }
    }

    if (started) {
      const startedKey = localDateKey(str(row.system_started_at) || plannedAt);
      const last = streamerLastLiveKey.get(streamerId);
      if (!last || startedKey > last) {
        streamerLastLiveKey.set(streamerId, startedKey);
      }
    }
  }

  // —— 成本 / 转化聚合（货 / 效）——
  const projectTrafficCost = new Map<string, number>();
  const projectOtherCost = new Map<string, number>();
  const projectConversion = new Map<string, PeriodTotals>();
  const streamerConversion = new Map<string, PeriodTotals>();

  for (const row of costItemRows) {
    if (str(row.status) === "voided") continue;
    const projectId = str(row.project_id);
    const streamerId = str(row.streamer_id);
    const dateKey = localDateKey(str(row.created_at));
    const amountCents = num(row.amount_cents);
    const direction = str(row.direction);
    const itemType = str(row.item_type);

    if (direction === "cost" && inPeriod(dateKey, periods.current)) {
      if (itemType === "traffic") {
        projectTrafficCost.set(
          projectId,
          (projectTrafficCost.get(projectId) ?? 0) + amountCents,
        );
      } else {
        projectOtherCost.set(
          projectId,
          (projectOtherCost.get(projectId) ?? 0) + amountCents,
        );
      }
    }
    if (
      direction === "revenue_offset" &&
      (itemType === "cpa" || itemType === "cps" || itemType === "gift")
    ) {
      addToPeriod(
        ensure(projectConversion, projectId, totals),
        dateKey,
        periods,
        amountCents,
      );
      if (streamerId) {
        addToPeriod(
          ensure(streamerConversion, streamerId, totals),
          dateKey,
          periods,
          amountCents,
        );
      }
    }
  }

  // —— 组装切片 ——
  const accountIdsByProject = new Map<string, string[]>();
  const accountSlices: XingyaoAccountSlice[] = accountRows.map((row) => {
    const boundStreamerId = str(row.bound_streamer_id);
    const projectIds = boundStreamerId
      ? [...(projectIdsByStreamer.get(boundStreamerId) ?? [])]
      : [];
    const id = str(row.id);
    for (const projectId of projectIds) {
      ensure(accountIdsByProject, projectId, () => [] as string[]).push(id);
    }
    const status = str(row.status) as XingyaoAccountStatus;
    return {
      id,
      platform: str(row.platform),
      handle: str(row.account_uid),
      status: ["active", "idle", "frozen", "retired"].includes(status)
        ? status
        : "active",
      projectIds,
      boundStreamerId: boundStreamerId || undefined,
      // 账号级流量 / 违规 / 时长留痕尚未接入，先以零值中性化处理，
      // 封禁风险暂由账号状态（frozen/idle）驱动。
      viewership: 0,
      previousViewership: 0,
      violationCount90d: 0,
      recentViolationCount30d: 0,
      avgDailyLiveMinutes: 0,
      peakDailyLiveMinutes: 0,
      followerCount: 0,
    };
  });

  const projectSlices: XingyaoProjectSlice[] = projectRows.map((row) => {
    const id = str(row.id);
    const receivable = projectReceivable.get(id) ?? totals();
    const payable = projectPayable.get(id) ?? totals();
    const viewers = projectViewers.get(id) ?? totals();
    const conversion = projectConversion.get(id) ?? totals();
    const sessions = projectSessions.get(id) ?? sessionCounter();
    return {
      id,
      name: str(row.name),
      status: str(row.status),
      receivableCents: receivable.current,
      previousReceivableCents: receivable.previous,
      payableCents: payable.current,
      paidTrafficCostCents: projectTrafficCost.get(id) ?? 0,
      otherCostCents: projectOtherCost.get(id) ?? 0,
      scheduledSessions: sessions.scheduled.current,
      startedSessions: sessions.started.current,
      greenEvidenceSessions: projectGreenSessions.get(id) ?? 0,
      viewership: viewers.current,
      previousViewership: viewers.previous,
      conversionGmvCents: conversion.current,
      previousConversionGmvCents: conversion.previous,
      streamerIds: [...projectIdsByStreamer.entries()]
        .filter(([, projectIds]) => projectIds.has(id))
        .map(([streamerId]) => streamerId),
      accountIds: accountIdsByProject.get(id) ?? [],
    };
  });

  const daysElapsed = Math.max(1, Number(nowKey.slice(8, 10)) || 1);

  const streamerSlices: XingyaoStreamerSlice[] = streamerRows.map((row) => {
    const id = str(row.id);
    const sessions = streamerSessions.get(id) ?? sessionCounter();
    const income = streamerIncome.get(id) ?? totals();
    const conversion = streamerConversion.get(id) ?? totals();
    const recentTasks = (streamerRecentTasks.get(id) ?? []).sort((a, b) =>
      a.dateKey.localeCompare(b.dateKey),
    );
    let consecutiveAbsences = 0;
    for (let index = recentTasks.length - 1; index >= 0; index -= 1) {
      if (recentTasks[index].started) break;
      consecutiveAbsences += 1;
    }
    const lastLiveKey = streamerLastLiveKey.get(id);
    const daysSinceLastLive = lastLiveKey
      ? Math.max(
          0,
          Math.round(
            (new Date(`${nowKey}T00:00:00Z`).getTime() -
              new Date(`${lastLiveKey}T00:00:00Z`).getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        )
      : 999;
    return {
      id,
      name: str(row.display_name),
      projectIds: [...(projectIdsByStreamer.get(id) ?? [])],
      scheduledSessions: sessions.scheduled.current,
      startedSessions: sessions.started.current,
      previousScheduledSessions: sessions.scheduled.previous,
      previousStartedSessions: sessions.started.previous,
      // 可用时段冲突留痕尚未结构化，先按零处理（排班合理性暂由强度驱动）。
      availabilityMismatchSessions: 0,
      avgDailyScheduledMinutes: Math.round(
        (streamerPlannedMinutes.get(id) ?? 0) / daysElapsed,
      ),
      // 试播测试通过与培训完成度的专属模块未落地前的显式代理：
      // probation = 仍在试用观察期；clean_report_count 反映规范化程度。
      testPassed: str(row.auto_trust) !== "probation",
      trainingCompletedRatioBps: Math.min(
        10_000,
        num(row.clean_report_count) * CLEAN_REPORT_TRAINING_STEP_BPS,
      ),
      absenceCount30d: (streamerMissedDates.get(id) ?? []).length,
      consecutiveAbsences,
      recentAbsenceDates: streamerMissedDates.get(id) ?? [],
      viewership: streamerViewers.get(id) ?? 0,
      conversionGmvCents: conversion.current,
      previousConversionGmvCents: conversion.previous,
      incomeCents: income.current,
      previousIncomeCents: income.previous,
      disputeCount: streamerDisputes.get(id) ?? 0,
      daysSinceLastLive,
    };
  });

  const settlementSlices: XingyaoSettlementSlice[] = batchRows
    .filter(
      (row) =>
        str(row.batch_type) === "receivable" &&
        !["locked", "voided"].includes(str(row.status)),
    )
    .map((row) => {
      const periodEndKey = str(row.period_end).slice(0, 10);
      const dueTime =
        new Date(`${periodEndKey}T00:00:00Z`).getTime() +
        RECEIVABLE_DUE_DAYS_AFTER_PERIOD * 24 * 60 * 60 * 1000;
      const dueInDays = Math.round(
        (dueTime - new Date(`${nowKey}T00:00:00Z`).getTime()) /
          (24 * 60 * 60 * 1000),
      );
      const amountYuan =
        (row.manual_amount === null || row.manual_amount === undefined
          ? num(row.computed_amount)
          : num(row.manual_amount)) + num(row.adjustment_amount);
      return {
        id: str(row.id),
        projectId: str(row.project_id) || undefined,
        counterparty: projectNameById.get(str(row.project_id)) ?? "未知合作方",
        amountCents: Math.round(amountYuan * 100),
        dueInDays: Number.isFinite(dueInDays) ? dueInDays : 0,
        // 对手方历史逾期率尚无留痕，先按零处理。
        counterpartyPastOverdueRateBps: 0,
        disputed: str(row.status) === "reopened",
      };
    });

  const knowledge: XingyaoKnowledgeSlice = {
    documentCount: knowledgeRows.length,
    playbookCount: knowledgeRows.filter(
      (row) => str(row.doc_type) === "playbook",
    ).length,
  };

  const recordings: XingyaoRecordingSlice = {
    analysisCount: recordingRows.length,
    highRiskCount: recordingRows.filter(
      (row) => strArray(row.risk_flags).length > 0,
    ).length,
    riskFlags: [
      ...new Set(recordingRows.flatMap((row) => strArray(row.risk_flags))),
    ].slice(0, 20),
  };

  return {
    organizationId,
    periodLabel: periods.current.label,
    generatedAt: now,
    periodElapsedRatioBps: periods.periodElapsedRatioBps,
    projects: projectSlices,
    streamers: streamerSlices,
    accounts: accountSlices,
    settlements: settlementSlices,
    timeslots: [...timeslotMap.values()],
    knowledge,
    recordings,
  };
}

export async function loadXingyaoFeatureStore({
  client,
  organizationId,
  now = new Date().toISOString(),
}: {
  client: XingyaoSnapshotClient;
  organizationId: string;
  now?: string;
}): Promise<XingyaoFeatureStore> {
  const input = await loadXingyaoFeatureStoreInput({
    client,
    organizationId,
    now,
  });
  return buildXingyaoFeatureStore(input);
}
