export type StreamerProjectReviewInput = {
  streamer: {
    id: string;
    displayName: string;
  };
  project: {
    id: string;
    name: string;
    productType?: string | null;
  };
  tasks: StreamerProjectReviewTask[];
  reports: StreamerProjectReviewReport[];
  recordings: StreamerProjectReviewRecording[];
};

export type StreamerProjectReviewTask = {
  id: string;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  status: string;
  systemDuration?: number | null;
};

export type StreamerProjectReviewReport = {
  id: string;
  taskId?: string | null;
  status: string;
  settlementDuration?: number | null;
  systemDuration?: number | null;
  viewers?: number | null;
  pcu?: number | null;
  acu?: number | null;
  evidenceLevel?: string | null;
  riskFlags?: string[] | null;
  submittedAt?: string | null;
};

export type StreamerProjectReviewRecording = {
  id: string;
  status: string;
  adopted?: boolean | null;
  rejectionReasons?: string[] | null;
  durationSeconds?: number | null;
};

export type StreamerProjectReviewFact = {
  statement: string;
  sourceTool: "streamer_project_profile";
  sourceId: string;
};

export type StreamerProjectReviewProfile = {
  streamer: StreamerProjectReviewInput["streamer"];
  project: Required<StreamerProjectReviewInput["project"]>;
  participation: {
    naturalDays: number;
    effectiveLiveDays: number;
    scheduledTaskCount: number;
    completedTaskCount: number;
    scheduleCompletionRateBps: number;
    totalSystemDuration: number;
    totalSettlementDuration: number;
    firstScheduledAt: string | null;
    lastScheduledAt: string | null;
  };
  liveMetrics: {
    reportCount: number;
    approvedReportCount: number;
    totalViewers: number;
    averageViewers: number | null;
    averagePcu: number | null;
    averageAcu: number | null;
    evidenceLevels: Record<string, number>;
    riskFlags: Record<string, number>;
  };
  recordings: {
    submittedCount: number;
    approvedCount: number;
    rejectedCount: number;
    adoptedCount: number;
    passRateBps: number;
    adoptionRateBps: number;
    rejectionRateBps: number;
    topRejectionReasons: Array<{ reason: string; count: number }>;
  };
  facts: StreamerProjectReviewFact[];
  findings: Array<{
    summary: string;
    evidence: Array<{ sourceTool: string; sourceId: string }>;
  }>;
  caveats: Array<{
    summary: string;
    unverifiedExternalFactor: boolean;
  }>;
  recommendations: Array<{
    proposal: string;
    expectedImpact?: string;
    requiresHumanApproval: true;
  }>;
  reviewDraft: {
    summary: string;
    participation: string;
    livePerformance: string;
    recordingPerformance: string;
    productFit: string;
    externalReference: {
      status: "not_connected";
      summary: string;
    };
    majorIssues: Array<{
      title: string;
      summary: string;
      sourceIds: string[];
    }>;
    opportunities: Array<{
      title: string;
      expectedImpact: string;
    }>;
    actionItems: Array<{
      proposal: string;
      expectedImpact?: string;
      requiresHumanApproval: true;
    }>;
    dataGaps: string[];
  };
};

export function buildStreamerProjectReviewProfile(
  input: StreamerProjectReviewInput,
): StreamerProjectReviewProfile {
  const tasks = input.tasks ?? [];
  const reports = input.reports ?? [];
  const recordings = input.recordings ?? [];
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const scheduledDates = tasks
    .flatMap((task) => [task.plannedStartAt, task.plannedEndAt])
    .filter((value): value is string => Boolean(value));
  const firstScheduledAt = minIso(scheduledDates);
  const lastScheduledAt = maxIso(scheduledDates);
  const effectiveDateKeys = new Set<string>();

  for (const task of tasks) {
    if (isTaskEffectivelyCompleted(task)) {
      const dateKey = dateKeyFromIso(task.plannedStartAt ?? task.plannedEndAt);
      if (dateKey) effectiveDateKeys.add(dateKey);
    }
  }
  for (const report of reports) {
    if (positiveNumber(report.settlementDuration ?? report.systemDuration) > 0) {
      const task = report.taskId ? taskById.get(report.taskId) : null;
      const dateKey = dateKeyFromIso(
        task?.plannedStartAt ?? task?.plannedEndAt ?? report.submittedAt,
      );
      if (dateKey) effectiveDateKeys.add(dateKey);
    }
  }

  const totalSystemDuration = sum(
    tasks.map((task) => positiveNumber(task.systemDuration)),
  );
  const totalSettlementDuration = sum(
    reports.map((report) => positiveNumber(report.settlementDuration)),
  );
  const totalViewers = sum(reports.map((report) => positiveNumber(report.viewers)));
  const pcuValues = reports
    .map((report) => positiveNumber(report.pcu))
    .filter((value) => value > 0);
  const acuValues = reports
    .map((report) => positiveNumber(report.acu))
    .filter((value) => value > 0);
  const viewerValues = reports
    .map((report) => positiveNumber(report.viewers))
    .filter((value) => value > 0);
  const recordingStatusCounts = countBy(recordings, (recording) => recording.status);
  const adoptedCount = recordings.filter((recording) => recording.adopted).length;
  const rejectedCount = recordingStatusCounts.rejected ?? 0;
  const approvedCount = recordingStatusCounts.approved ?? 0;
  const caveats = buildCaveats({ tasks, reports, recordings });
  const findings = buildFindings({
    reports,
    recordings,
    effectiveLiveDays: effectiveDateKeys.size,
  });
  const recommendations = buildRecommendations({ findings, caveats });
  const topRejectionReasons = topReasons(recordings);
  const participation = {
    naturalDays: inclusiveDays(firstScheduledAt, lastScheduledAt),
    effectiveLiveDays: effectiveDateKeys.size,
    scheduledTaskCount: tasks.length,
    completedTaskCount: tasks.filter(isTaskEffectivelyCompleted).length,
    scheduleCompletionRateBps: ratioBps(effectiveDateKeys.size, tasks.length),
    totalSystemDuration,
    totalSettlementDuration,
    firstScheduledAt,
    lastScheduledAt,
  };
  const liveMetrics = {
    reportCount: reports.length,
    approvedReportCount: reports.filter((report) => report.status === "approved")
      .length,
    totalViewers,
    averageViewers: averageOrNull(viewerValues),
    averagePcu: averageOrNull(pcuValues),
    averageAcu: averageOrNull(acuValues),
    evidenceLevels: countByString(
      reports.map((report) => report.evidenceLevel).filter(Boolean),
    ),
    riskFlags: countByString(reports.flatMap((report) => report.riskFlags ?? [])),
  };
  const recordingMetrics = {
    submittedCount: recordings.length,
    approvedCount,
    rejectedCount,
    adoptedCount,
    passRateBps: ratioBps(approvedCount, recordings.length),
    adoptionRateBps: ratioBps(adoptedCount, recordings.length),
    rejectionRateBps: ratioBps(rejectedCount, recordings.length),
    topRejectionReasons,
  };
  const project = {
    id: input.project.id,
    name: input.project.name,
    productType: input.project.productType ?? "unknown",
  };

  return {
    streamer: input.streamer,
    project,
    participation,
    liveMetrics,
    recordings: recordingMetrics,
    facts: buildFacts({ tasks, reports, recordings }),
    findings,
    caveats,
    recommendations,
    reviewDraft: buildReviewDraft({
      streamer: input.streamer,
      project,
      participation,
      liveMetrics,
      recordings: recordingMetrics,
      sourceRecordings: recordings,
      caveats,
      recommendations,
    }),
  };
}

function isTaskEffectivelyCompleted(task: StreamerProjectReviewTask): boolean {
  return (
    task.status === "completed" ||
    task.status === "report_approved" ||
    positiveNumber(task.systemDuration) > 0
  );
}

function buildFacts(input: {
  tasks: StreamerProjectReviewTask[];
  reports: StreamerProjectReviewReport[];
  recordings: StreamerProjectReviewRecording[];
}): StreamerProjectReviewFact[] {
  return [
    ...input.tasks.map((task) => ({
      statement: `排班 ${task.id} 状态为 ${task.status}。`,
      sourceTool: "streamer_project_profile" as const,
      sourceId: task.id,
    })),
    ...input.reports.map((report) => ({
      statement: `报数 ${report.id} 状态为 ${report.status}。`,
      sourceTool: "streamer_project_profile" as const,
      sourceId: report.id,
    })),
    ...input.recordings.map((recording) => ({
      statement: `录屏 ${recording.id} 状态为 ${recording.status}。`,
      sourceTool: "streamer_project_profile" as const,
      sourceId: recording.id,
    })),
  ];
}

function buildFindings(input: {
  reports: StreamerProjectReviewReport[];
  recordings: StreamerProjectReviewRecording[];
  effectiveLiveDays: number;
}): StreamerProjectReviewProfile["findings"] {
  const findings: StreamerProjectReviewProfile["findings"] = [];
  const rejectedRecordings = input.recordings.filter(
    (recording) => recording.status === "rejected",
  );
  if (input.effectiveLiveDays > 0) {
    findings.push({
      summary: `该主播在项目内已有 ${input.effectiveLiveDays} 个有效直播日。`,
      evidence: input.reports.map((report) => ({
        sourceTool: "streamer_project_profile",
        sourceId: report.id,
      })),
    });
  }
  if (rejectedRecordings.length > 0) {
    findings.push({
      summary: `存在 ${rejectedRecordings.length} 条录屏驳回记录，需要复盘录屏质量。`,
      evidence: rejectedRecordings.map((recording) => ({
        sourceTool: "streamer_project_profile",
        sourceId: recording.id,
      })),
    });
  }
  return findings;
}

function buildCaveats(input: {
  tasks: StreamerProjectReviewTask[];
  reports: StreamerProjectReviewReport[];
  recordings: StreamerProjectReviewRecording[];
}): StreamerProjectReviewProfile["caveats"] {
  const caveats: StreamerProjectReviewProfile["caveats"] = [];
  if (input.tasks.length === 0) {
    caveats.push({
      summary: "缺少该主播在此项目的排班记录。",
      unverifiedExternalFactor: false,
    });
  }
  if (input.reports.length === 0) {
    caveats.push({
      summary: "缺少该主播在此项目的报数记录。",
      unverifiedExternalFactor: false,
    });
  }
  if (input.recordings.length === 0) {
    caveats.push({
      summary: "缺少该主播在此项目的录屏记录。",
      unverifiedExternalFactor: false,
    });
  }
  return caveats;
}

function buildRecommendations(input: {
  findings: StreamerProjectReviewProfile["findings"];
  caveats: StreamerProjectReviewProfile["caveats"];
}): StreamerProjectReviewProfile["recommendations"] {
  if (input.caveats.length > 0) {
    return [
      {
        proposal: "先补齐缺失的排班、报数或录屏数据，再生成正式主播复盘结论。",
        expectedImpact: "减少因样本不足导致的误判。",
        requiresHumanApproval: true,
      },
    ];
  }
  if (input.findings.some((finding) => finding.summary.includes("录屏驳回"))) {
    return [
      {
        proposal: "安排运营针对主要录屏驳回原因进行一次主播复盘。",
        expectedImpact: "提升后续录屏采用率和项目交付稳定性。",
        requiresHumanApproval: true,
      },
    ];
  }
  return [
    {
      proposal: "维持当前排班节奏，并持续观察下一轮直播数据。",
      expectedImpact: "在不扩大风险的情况下积累更多样本。",
      requiresHumanApproval: true,
    },
  ];
}

function buildReviewDraft(input: {
  streamer: StreamerProjectReviewProfile["streamer"];
  project: StreamerProjectReviewProfile["project"];
  participation: StreamerProjectReviewProfile["participation"];
  liveMetrics: StreamerProjectReviewProfile["liveMetrics"];
  recordings: StreamerProjectReviewProfile["recordings"];
  sourceRecordings: StreamerProjectReviewRecording[];
  caveats: StreamerProjectReviewProfile["caveats"];
  recommendations: StreamerProjectReviewProfile["recommendations"];
}): StreamerProjectReviewProfile["reviewDraft"] {
  const externalReferenceSummary = "暂未接入外部同类产品或同行表现参照。";
  const topReasonText =
    input.recordings.topRejectionReasons.map((item) => item.reason).join("、") ||
    "暂无录屏驳回原因";
  const rejectedRecordingIds = input.sourceRecordings
    .filter((recording) => recording.status === "rejected")
    .map((recording) => recording.id);
  const majorIssues =
    rejectedRecordingIds.length > 0
      ? [
          {
            title: "录屏质量需要复盘",
            summary: `主要驳回原因：${topReasonText}。`,
            sourceIds: rejectedRecordingIds,
          },
        ]
      : [];
  const dataGaps = [
    ...input.caveats.map((caveat) => caveat.summary),
    externalReferenceSummary,
  ];

  return {
    summary: `${input.streamer.displayName}在${input.project.name}项目已形成 ${input.participation.effectiveLiveDays} 个有效直播日，排班完成率 ${formatBps(input.participation.scheduleCompletionRateBps)}，录屏采用率 ${formatBps(input.recordings.adoptionRateBps)}。`,
    participation: `自然参与 ${input.participation.naturalDays} 天，有效履约 ${input.participation.effectiveLiveDays} 天，排班完成率 ${formatBps(input.participation.scheduleCompletionRateBps)}。`,
    livePerformance: `累计场观 ${input.liveMetrics.totalViewers}，平均场观 ${input.liveMetrics.averageViewers ?? 0}，平均 PCU ${input.liveMetrics.averagePcu ?? 0}，平均 ACU ${input.liveMetrics.averageAcu ?? 0}。`,
    recordingPerformance: `录屏提交 ${input.recordings.submittedCount} 条，通过率 ${formatBps(input.recordings.passRateBps)}，采用率 ${formatBps(input.recordings.adoptionRateBps)}，主要驳回原因：${topReasonText}。`,
    productFit: `当前项目产品类型为 ${input.project.productType}，适配判断基于内部排班、直播报数与录屏记录生成。`,
    externalReference: {
      status: "not_connected",
      summary: externalReferenceSummary,
    },
    majorIssues,
    opportunities: majorIssues.length
      ? [
          {
            title: "围绕主要驳回原因优化录屏脚本和画面检查",
            expectedImpact: "提升后续录屏采用率，并减少重复打回。",
          },
        ]
      : [
          {
            title: "继续积累同类项目样本",
            expectedImpact: "提高后续产品适配判断的稳定性。",
          },
        ],
    actionItems: input.recommendations,
    dataGaps,
  };
}

function topReasons(
  recordings: StreamerProjectReviewRecording[],
): Array<{ reason: string; count: number }> {
  return Object.entries(
    countByString(recordings.flatMap((recording) => recording.rejectionReasons ?? [])),
  )
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
}

function countBy<T>(items: T[], keyFor: (item: T) => string): Record<string, number> {
  return countByString(items.map(keyFor));
}

function countByString(items: Array<string | null | undefined>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (!item) continue;
    counts[item] = (counts[item] ?? 0) + 1;
  }
  return counts;
}

function minIso(values: string[]): string | null {
  return values.length ? [...values].sort()[0] : null;
}

function maxIso(values: string[]): string | null {
  return values.length ? [...values].sort().at(-1) ?? null : null;
}

function inclusiveDays(firstIso: string | null, lastIso: string | null): number {
  const first = dateKeyFromIso(firstIso);
  const last = dateKeyFromIso(lastIso);
  if (!first || !last) return 0;
  const firstTime = Date.parse(`${first}T00:00:00.000Z`);
  const lastTime = Date.parse(`${last}T00:00:00.000Z`);
  if (!Number.isFinite(firstTime) || !Number.isFinite(lastTime)) return 0;
  return Math.max(0, Math.round((lastTime - firstTime) / 86_400_000) + 1);
}

function dateKeyFromIso(value: string | null | undefined): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString().slice(0, 10);
}

function positiveNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function averageOrNull(values: number[]): number | null {
  return values.length ? Math.round(sum(values) / values.length) : null;
}

function ratioBps(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 10_000) : 0;
}

function formatBps(value: number): string {
  return `${(value / 100).toFixed(2)}%`;
}
