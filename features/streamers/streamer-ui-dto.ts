import type { StreamerListRow } from "./streamer-queries";
import { toYuan } from "@/features/billing/hourly-rate-units";
import {
  deriveAuthoritativeReportEconomics,
  selectAuthoritativeApprovedReports,
} from "./streamer-report-economics";

const sourceLabels: Record<string, string> = {
  signed: "签约",
  self_incubated: "自孵化",
  internal: "自孵化",
  external: "外部",
  supplier_recommended: "供应商",
  account_managed: "代运营",
};

export type StreamerCardDto = {
  id: string;
  alias: string;
  real: string;
  gender: string;
  source: string;
  supplier: string;
  games: string[];
  platforms: string[];
  style: string;
  cooperation: string;
  risk: string;
  defaultRule: string;
  settlement: {
    method: string;
    cptHourlyRate: number;
    baseSalary: number;
    cpsRateBps: number;
    label: string;
  };
  hasPerformanceData: boolean;
  createdAtLabel: string;
  matchScore: number | null;
  matchTrend: Array<number | null>;
  metrics: {
    screenPass: number | null;
    projectFinish: number | null;
    avgSessionMinutes: number | null;
    actualHourlyRate: number | null;
    roi: number | null;
    viewsPerHour: number | null;
    grossContrib: number | null;
    vendorPassRateBps: number | null;
    rejectionReasonHistogram: Record<string, number>;
    evaluatedCount: number;
    mcnFirstPassRateBps: number | null;
    mcnFirstEvaluatedCount: number;
  };
  projects: StreamerProjectContributionDto[];
  aiInsights: StreamerAiInsightDto[];
};

export type StreamerProjectContributionDto = {
  id: string;
  code: string;
  name: string;
  status: string;
  settlementHours: number | null;
  grossContrib: number | null;
};

export type StreamerAiInsightDto = {
  id: string;
  title: string;
  summary: string;
  strengths: string[];
  risks: string[];
  recommendations: string[];
  tags: string[];
  sourceRef: string;
  confirmedAtLabel: string;
};

export type StreamerDesktopProfileDto = {
  id: string;
  alias: string;
  real: string;
  gender: string;
  level: string;
  signedAt: string;
  org: string;
  stats: {
    projectCount: number;
    recordingCount: number;
    totalLiveHours: number;
  };
  platforms: Array<{
    id: string;
    platform: string;
    account: string;
    followers: number;
    primary: boolean;
    verified: boolean;
  }>;
  tags: {
    categories: string[];
    styles: string[];
    skills: string[];
    availability: string[];
    equipment: string[];
  };
  settlement: {
    rule: string;
    cycle: string;
    baseSalary: string;
    cpt: string;
    cpsShare: string;
    giftShare: string;
    bank: string;
  };
  security: {
    password: string;
    mfa: string;
    notifications: string;
    devices: string;
  };
  aiInsights: StreamerAiInsightDto[];
};

export function toStreamerCardDto(
  row: StreamerListRow,
  options: { now?: string } = {},
): StreamerCardDto {
  const liveMetrics = deriveLivePerformance(row, options);
  const settlement = settlementSummary(row);
  const admissionStats = row.admission_stats;
  const hasAdmissionData =
    (admissionStats?.evaluatedCount ?? 0) > 0 ||
    (admissionStats?.mcnFirstEvaluatedCount ?? 0) > 0;

  return {
    id: row.id,
    alias: row.display_name,
    real: row.real_name ?? "未填写",
    gender: row.gender ?? "未填写",
    source: sourceLabels[row.source_type] ?? row.source_type,
    supplier: "未绑定",
    games: row.categories.length > 0 ? row.categories : ["未填写"],
    platforms: row.platforms.length > 0 ? row.platforms : ["未填写"],
    style: row.styles[0] ?? "未填写",
    cooperation: row.cooperation_status,
    risk: row.risk_level,
    defaultRule: settlement.label,
    settlement,
    hasPerformanceData: liveMetrics.hasPerformanceData || hasAdmissionData,
    createdAtLabel: row.created_at.slice(0, 10),
    matchScore: liveMetrics.matchScore,
    matchTrend: liveMetrics.matchTrend,
    metrics: {
      ...liveMetrics.metrics,
      vendorPassRateBps: row.admission_stats?.vendorPassRateBps ?? null,
      rejectionReasonHistogram: admissionStats?.rejectionReasonHistogram ?? {},
      evaluatedCount: admissionStats?.evaluatedCount ?? 0,
      mcnFirstPassRateBps: admissionStats?.mcnFirstPassRateBps ?? null,
      mcnFirstEvaluatedCount: admissionStats?.mcnFirstEvaluatedCount ?? 0,
    },
    projects: liveMetrics.projects,
    aiInsights: streamerAiInsights(row),
  };
}

export function toStreamerCardDtos(rows: StreamerListRow[]) {
  return rows.map((row) => toStreamerCardDto(row));
}

export function toStreamerDesktopProfileDto(
  row: StreamerListRow,
  options: { organizationName?: string } = {},
): StreamerDesktopProfileDto {
  const authoritativeReports = selectAuthoritativeApprovedReports(
    row.live_reports ?? [],
  );
  const projectIds = new Set<string>();
  row.project_streamers?.forEach((item) => {
    const project = first(item.projects);
    const id = item.project_id ?? project?.id;
    if (id) projectIds.add(id);
  });
  authoritativeReports.forEach((item) => {
    if (item.project_id) projectIds.add(item.project_id);
  });

  const baseSalary = Number(row.default_base_salary ?? 0);
  const cpt = Number(row.default_price ?? 0);
  const cpsRateBps = Number(row.default_cps_rate_bps ?? 0);
  const settlementMethod = row.default_settlement_method || "unset";

  return {
    id: row.id,
    alias: row.display_name || "未配置昵称",
    real: row.real_name || "未配置实名",
    gender: row.gender || "未配置",
    level: profileStatusLabel(row.cooperation_status),
    signedAt: row.created_at ? row.created_at.slice(0, 10) : "未配置",
    org: options.organizationName || "未配置组织",
    stats: {
      projectCount: projectIds.size,
      recordingCount: row.recording_submissions?.length ?? 0,
      totalLiveHours: roundHours(
        authoritativeReports.reduce(
          (sum, report) =>
            sum + minutesToHours(report.settlement_duration ?? 0),
          0,
        ),
      ),
    },
    platforms: profilePlatforms(row),
    tags: {
      categories: nonEmptyTags(row.categories, "未配置品类"),
      styles: nonEmptyTags(row.styles, "未配置风格"),
      skills: nonEmptyTags(row.skills, "未配置技能"),
      availability: nonEmptyTags(
        extractStringValues(row.availability),
        "未配置时间",
      ),
      equipment: nonEmptyTags(extractStringValues(row.equipment), "未配置设备"),
    },
    settlement: {
      rule: settlementRuleLabel(settlementMethod, baseSalary, cpt, cpsRateBps),
      cycle: baseSalary > 0 ? "按月结" : "按项目规则",
      baseSalary:
        baseSalary > 0 ? `¥${formatNumber(baseSalary)} / 月` : "未配置",
      cpt: cpt > 0 ? `¥${formatNumber(cpt)} / 有效直播小时` : "未配置",
      cpsShare: cpsRateBps > 0 ? `${formatPercentBps(cpsRateBps)}%` : "未配置",
      giftShare: "按项目规则配置",
      bank: "未向前端暴露",
    },
    security: {
      password: "由账号系统管理",
      mfa: "按账号设置",
      notifications: "任务 / 审核 / AI",
      devices: "仅显示当前会话权限",
    },
    aiInsights: streamerAiInsights(row),
  };
}

function streamerAiInsights(row: StreamerListRow): StreamerAiInsightDto[] {
  return [...(row.streamer_profile_insights ?? [])]
    .sort((a, b) => dateMs(b.confirmed_at ?? "") - dateMs(a.confirmed_at ?? ""))
    .slice(0, 5)
    .map((insight) => ({
      id: insight.id,
      title: insight.title || "AI 观察",
      summary: insight.summary || "暂无摘要",
      strengths: cleanStringList(insight.strengths),
      risks: cleanStringList(insight.risks),
      recommendations: cleanStringList(insight.recommendations),
      tags: cleanStringList(insight.tags),
      sourceRef:
        insight.source_ref || `streamer_profile_insights:${insight.id}`,
      confirmedAtLabel: insight.confirmed_at
        ? insight.confirmed_at.slice(0, 10)
        : "未标注",
    }));
}

function cleanStringList(values?: string[] | null): string[] {
  return (values ?? []).map((value) => String(value).trim()).filter(Boolean);
}

function dateMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function profileStatusLabel(status: string) {
  const labels: Record<string, string> = {
    not_started: "待配置",
    active: "合作中",
    signed: "已签约",
    inactive: "已停用",
    pending: "待配置",
  };
  return labels[status] ?? status ?? "未配置档案";
}

function profilePlatforms(row: StreamerListRow) {
  const accounts = row.streamer_accounts ?? [];
  if (accounts.length > 0) {
    return accounts
      .map((account) => ({
        id: account.id,
        platform: account.platform || "未配置平台",
        account: account.account_handle || "未配置账号",
        followers: Math.max(account.follower_count ?? 0, 0),
        primary: Boolean(account.is_primary),
        verified: Boolean(account.verified_at),
      }))
      .sort((a, b) => Number(b.primary) - Number(a.primary));
  }

  return (row.platforms ?? []).map((platform, index) => ({
    id: `${platform || "platform"}-${index + 1}`,
    platform: platform || "未配置平台",
    account: "未配置账号",
    followers: 0,
    primary: index === 0,
    verified: false,
  }));
}

function nonEmptyTags(values: string[] | undefined, fallback: string) {
  const tags = (values ?? [])
    .map((value) => String(value).trim())
    .filter(Boolean);
  return tags.length > 0 ? tags : [fallback];
}

function extractStringValues(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractStringValues(item));
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) =>
      extractStringValues(item),
    );
  }
  return [];
}

function settlementSummary(row: StreamerListRow) {
  const method = row.default_settlement_method || "manual";
  const cptHourlyRate = Number(row.default_price ?? 0);
  const baseSalary = Number(row.default_base_salary ?? 0);
  const cpsRateBps = Number(row.default_cps_rate_bps ?? 0);
  return {
    method,
    cptHourlyRate,
    baseSalary,
    cpsRateBps,
    label: settlementRuleLabel(method, baseSalary, cptHourlyRate, cpsRateBps),
  };
}

function settlementRuleLabel(
  method: string,
  baseSalary: number,
  cpt: number,
  cpsRateBps = 0,
) {
  const baseText = baseSalary > 0 ? `底薪 ¥${formatNumber(baseSalary)}` : "";
  const cptText = cpt > 0 ? `CPT ¥${formatNumber(cpt)}/h` : "";
  const cpsText = cpsRateBps > 0 ? `CPS ${formatPercentBps(cpsRateBps)}%` : "";

  if (method === "base_salary_cpt") {
    return [baseText || "底薪", cptText || "CPT"].join(" + ");
  }
  if (method === "base_salary") {
    return baseText || "底薪";
  }
  if (method === "cpt") {
    return cptText || "CPT";
  }
  if (method === "cps") {
    return cpsText || "CPS";
  }
  return method ? method.toUpperCase() : "未配置";
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatPercentBps(value: number) {
  const percent = value / 100;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2);
}

function deriveLivePerformance(
  row: StreamerListRow,
  options: { now?: string },
) {
  const now = options.now ? new Date(options.now) : new Date();
  const recentRecordings = recentRows(row.recording_submissions, now, (item) =>
    item.submitted_at ? new Date(item.submitted_at) : null,
  );
  const recentReportRows = recentRows(row.live_reports, now, (item) =>
    item.created_at ? new Date(item.created_at) : null,
  );
  const reportEconomics =
    deriveAuthoritativeReportEconomics(
      recentReportRows,
      undefined,
      row.id,
    );
  const recentReports = reportEconomics.authoritativeReports;
  const recentTasks = recentRows(row.live_tasks, now, (item) =>
    item.planned_start_at ? new Date(item.planned_start_at) : null,
  ).filter((item) => item.status !== "cancelled");
  const projectRows = row.project_streamers ?? [];

  const hasPerformanceData =
    recentRecordings.length > 0 ||
    recentReportRows.length > 0 ||
    recentTasks.length > 0;
  if (!hasPerformanceData) {
    return {
      hasPerformanceData: false,
      matchScore: null,
      matchTrend: [],
      metrics: {
        screenPass: null,
        projectFinish: null,
        avgSessionMinutes: null,
        actualHourlyRate: null,
        roi: null,
        viewsPerHour: null,
        grossContrib: null,
      },
      projects: streamerProjectContributions(projectRows, recentReports),
    };
  }

  const screenPass =
    recentRecordings.length > 0
      ? percentage(
          passCount(recentRecordings, (item) =>
            isPassedRecordingOrReport(item),
          ),
          recentRecordings.length,
        )
      : null;
  const projectFinish =
    recentTasks.length > 0
      ? percentage(
          passCount(recentTasks, (item) => isFinishedTask(item.status)),
          recentTasks.length,
        )
      : null;
  const grossContrib = aggregateReportContribution(recentReports);
  const roi = reportEconomics.roi;

  const matchScore = performanceMatchScore({
    screenPass,
    projectFinish,
    roi,
    reportCount: recentReports.length,
    risk: row.risk_level,
  });

  return {
    hasPerformanceData: true,
    matchScore,
    matchTrend: weeklyMatchTrend(row, now),
    metrics: {
      screenPass,
      projectFinish,
      avgSessionMinutes: reportEconomics.avgSessionMinutes,
      actualHourlyRate: reportEconomics.actualHourlyRate,
      roi,
      viewsPerHour: reportEconomics.viewsPerHour,
      grossContrib,
    },
    projects: streamerProjectContributions(projectRows, recentReports),
  };
}

function weeklyMatchTrend(row: StreamerListRow, now: Date) {
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const trend: Array<number | null> = [];

  for (let index = 5; index >= 0; index -= 1) {
    const end = new Date(now.getTime() - index * weekMs);
    const start = new Date(end.getTime() - weekMs);
    const recordings = rowsBetween(
      row.recording_submissions,
      start,
      end,
      (item) => (item.submitted_at ? new Date(item.submitted_at) : null),
    );
    const reportRows = rowsBetween(row.live_reports, start, end, (item) =>
      item.created_at ? new Date(item.created_at) : null,
    );
    const reportEconomics =
      deriveAuthoritativeReportEconomics(
        reportRows,
        undefined,
        row.id,
      );
    const reports = reportEconomics.authoritativeReports;
    const tasks = rowsBetween(row.live_tasks, start, end, (item) =>
      item.planned_start_at ? new Date(item.planned_start_at) : null,
    ).filter((item) => item.status !== "cancelled");

    if (
      recordings.length === 0 &&
      reportRows.length === 0 &&
      tasks.length === 0
    ) {
      trend.push(null);
      continue;
    }

    const screenPass =
      recordings.length > 0
        ? percentage(
            passCount(recordings, (item) => isPassedRecordingOrReport(item)),
            recordings.length,
          )
        : null;
    const projectFinish =
      tasks.length > 0
        ? percentage(
            passCount(tasks, (item) => isFinishedTask(item.status)),
            tasks.length,
          )
        : null;
    const roi = reportEconomics.roi;
    trend.push(
      performanceMatchScore({
        screenPass,
        projectFinish,
        roi,
        reportCount: reports.length,
        risk: row.risk_level,
      }),
    );
  }

  return trend;
}

function recentRows<T>(
  rows: T[] | undefined,
  now: Date,
  getDate: (row: T) => Date | null,
) {
  const cutoff = now.getTime() - 90 * 24 * 60 * 60 * 1000;
  return (rows ?? []).filter((row) => {
    const date = getDate(row);
    if (!date || Number.isNaN(date.getTime())) return true;
    return date.getTime() >= cutoff && date.getTime() <= now.getTime();
  });
}

function rowsBetween<T>(
  rows: T[] | undefined,
  start: Date,
  end: Date,
  getDate: (row: T) => Date | null,
) {
  return (rows ?? []).filter((row) => {
    const date = getDate(row);
    if (!date || Number.isNaN(date.getTime())) return false;
    return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
  });
}

function isPassedRecordingOrReport(item: {
  status: string;
  evidence_level?: string | null;
}) {
  return item.status === "approved" || item.evidence_level === "green";
}

function isFinishedTask(status: string) {
  return ["completed", "report_approved", "approved"].includes(status);
}

function passCount<T>(rows: T[], predicate: (row: T) => boolean) {
  return rows.filter(predicate).length;
}

function percentage(pass: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((pass / total) * 100);
}

function reportContribution(
  report: NonNullable<StreamerListRow["live_reports"]>[number],
): number | null {
  const rate = first(report.projects)?.default_hourly_rate;
  if (!isFiniteNumber(report.settlement_duration) || !isFiniteNumber(rate)) {
    return null;
  }
  return minutesToHours(report.settlement_duration) * toYuan(rate);
}

function aggregateReportContribution(
  reports: NonNullable<StreamerListRow["live_reports"]>,
): number | null {
  if (reports.length === 0) return null;
  const contributions = reports.map(reportContribution);
  const completeContributions = contributions.filter(isFiniteNumber);
  if (completeContributions.length !== contributions.length) return null;
  return roundMoney(
    completeContributions.reduce((sum, value) => sum + value, 0),
  );
}

function streamerProjectContributions(
  projectRows: NonNullable<StreamerListRow["project_streamers"]>,
  reports: NonNullable<StreamerListRow["live_reports"]>,
) {
  const rows = new Map<string, StreamerProjectContributionDto>();
  const reportsByProject = new Map<
    string,
    NonNullable<StreamerListRow["live_reports"]>
  >();
  projectRows.forEach((row) => {
    const project = first(row.projects);
    const id = row.project_id || project?.id;
    if (!id) return;
    rows.set(id, {
      id,
      code: project?.code ?? id,
      name: project?.name ?? id,
      status: row.status || project?.status || "joined",
      settlementHours: null,
      grossContrib: null,
    });
  });

  reports.forEach((report) => {
    const id = report.project_id;
    if (!id) return;
    const current =
      rows.get(id) ??
      ({
        id,
        code: id,
        name: id,
        status: "reported",
        settlementHours: null,
        grossContrib: null,
      } satisfies StreamerProjectContributionDto);
    rows.set(id, current);
    const projectReports = reportsByProject.get(id) ?? [];
    projectReports.push(report);
    reportsByProject.set(id, projectReports);
  });

  reportsByProject.forEach((projectReports, id) => {
    const current = rows.get(id);
    if (!current) return;
    current.settlementHours = projectReports.every((report) =>
      isFiniteNumber(report.settlement_duration),
    )
      ? roundHours(
          projectReports.reduce(
            (sum, report) =>
              sum + minutesToHours(report.settlement_duration as number),
            0,
          ),
        )
      : null;
    current.grossContrib = aggregateReportContribution(projectReports);
  });

  return Array.from(rows.values()).sort(
    (a, b) => (b.settlementHours ?? -1) - (a.settlementHours ?? -1),
  );
}

function performanceMatchScore({
  screenPass,
  projectFinish,
  roi,
  reportCount,
  risk,
}: {
  screenPass: number | null;
  projectFinish: number | null;
  roi: number | null;
  reportCount: number;
  risk: string;
}): number | null {
  const dimensions = [
    { value: screenPass, weight: 0.25 },
    { value: projectFinish, weight: 0.45 },
    {
      value: roi === null ? null : Math.min(100, (roi / 1.5) * 100),
      weight: 0.2,
    },
  ].filter(
    (
      dimension,
    ): dimension is {
      value: number;
      weight: number;
    } => dimension.value !== null,
  );
  if (dimensions.length === 0) return null;

  const observedScore = dimensions.reduce(
    (sum, dimension) => sum + dimension.value * dimension.weight,
    0,
  );
  const riskPenalty = risk === "high" ? 12 : risk === "medium" ? 6 : 0;
  return Math.max(
    0,
    Math.min(
      99,
      Math.round(observedScore + Math.min(10, reportCount * 3) - riskPenalty),
    ),
  );
}

function minutesToHours(minutes: number) {
  return Math.max(0, minutes) / 60;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roundHours(value: number) {
  return Math.round(value * 10) / 10;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}
