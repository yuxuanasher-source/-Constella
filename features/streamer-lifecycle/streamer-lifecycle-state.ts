// 主播全生命周期的纯状态机与派生规则：无 IO，供 service 与测试复用。

export const STREAMER_LIFECYCLE_STAGES = [
  "recruited",
  "trial",
  "training",
  "regular",
  "paused",
  "eliminated",
] as const;
export type StreamerLifecycleStage = (typeof STREAMER_LIFECYCLE_STAGES)[number];

export const STREAMER_RATINGS = ["unrated", "s", "a", "b", "c"] as const;
export type StreamerRating = (typeof STREAMER_RATINGS)[number];

export const allowedLifecycleStageTransitions: Record<
  StreamerLifecycleStage,
  StreamerLifecycleStage[]
> = {
  recruited: ["trial", "eliminated"],
  trial: ["training", "regular", "paused", "eliminated"],
  training: ["regular", "paused", "eliminated"],
  regular: ["paused", "eliminated"],
  paused: ["trial", "training", "regular", "eliminated"],
  eliminated: [],
};

export function assertLifecycleStageTransition(
  from: StreamerLifecycleStage,
  to: StreamerLifecycleStage,
): void {
  if (!allowedLifecycleStageTransitions[from]?.includes(to)) {
    throw new Error(`Lifecycle stage cannot change from ${from} to ${to}`);
  }
}

export const STREAMER_ASSESSMENT_TYPES = [
  "trial",
  "training",
  "probation",
  "periodic",
] as const;
export type StreamerAssessmentType = (typeof STREAMER_ASSESSMENT_TYPES)[number];

export const STREAMER_ASSESSMENT_STATUSES = [
  "pending",
  "passed",
  "failed",
] as const;
export type StreamerAssessmentStatus =
  (typeof STREAMER_ASSESSMENT_STATUSES)[number];

export const ATTENDANCE_STATUSES = [
  "on_time",
  "late",
  "absent",
  "leave",
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

// 开播晚于计划开始超过该分钟数记为迟到。
export const ATTENDANCE_LATE_GRACE_MINUTES = 5;

export type AttendanceCandidateTask = {
  taskId: string;
  streamerId: string;
  projectId: string | null;
  status: string;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  systemStartedAt: string | null;
  systemStoppedAt: string | null;
  systemDuration: number;
};

export type DerivedAttendance = {
  attendanceStatus: AttendanceStatus;
  lateMinutes: number;
  liveMinutes: number;
};

// 从排班任务的系统计时推导出勤结论；尚无法判定（未排期 / 已取消 / 还没到判定时间）返回 null。
export function deriveAttendanceFromTask(
  task: AttendanceCandidateTask,
  now: Date,
): DerivedAttendance | null {
  if (!task.plannedStartAt || task.status === "cancelled") {
    return null;
  }

  const plannedStart = new Date(task.plannedStartAt);

  if (!task.systemStartedAt) {
    const plannedEnd = task.plannedEndAt ? new Date(task.plannedEndAt) : null;
    if (!plannedEnd || plannedEnd.getTime() > now.getTime()) {
      return null;
    }

    return { attendanceStatus: "absent", lateMinutes: 0, liveMinutes: 0 };
  }

  const startedAt = new Date(task.systemStartedAt);
  const lateMinutes = Math.max(
    0,
    Math.round((startedAt.getTime() - plannedStart.getTime()) / 60000),
  );

  return {
    attendanceStatus:
      lateMinutes > ATTENDANCE_LATE_GRACE_MINUTES ? "late" : "on_time",
    lateMinutes,
    liveMinutes: Math.max(0, task.systemDuration ?? 0),
  };
}

export const SHIFT_CHANGE_TYPES = ["reschedule", "substitute"] as const;
export type ShiftChangeType = (typeof SHIFT_CHANGE_TYPES)[number];

export const SHIFT_CHANGE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type ShiftChangeStatus = (typeof SHIFT_CHANGE_STATUSES)[number];

export const allowedShiftChangeTransitions: Record<
  ShiftChangeStatus,
  ShiftChangeStatus[]
> = {
  pending: ["approved", "rejected", "cancelled"],
  approved: [],
  rejected: [],
  cancelled: [],
};

export function assertShiftChangeTransition(
  from: ShiftChangeStatus,
  to: ShiftChangeStatus,
): void {
  if (!allowedShiftChangeTransitions[from]?.includes(to)) {
    throw new Error(`Shift change request cannot change from ${from} to ${to}`);
  }
}

export type PerformanceSourceTask = {
  taskId: string;
  status: string;
  plannedStartAt: string | null;
  systemStartedAt: string | null;
  systemDuration: number;
  settlementDuration: number | null;
  viewers: number | null;
  projectHourlyRate: number | null;
};

export type PerformanceMetrics = {
  scheduledSessions: number;
  liveSessions: number;
  completedSessions: number;
  broadcastRateBps: number;
  totalLiveMinutes: number;
  totalRevenueAmount: number;
  avgSessionRevenueAmount: number;
  avgSessionRoiBps: number | null;
  totalViewers: number;
  avgSessionViewers: number;
};

// 聚合统计窗口内的主播绩效。金额口径与结算引擎一致：结算时长(小时) × 项目时薪（元）。
// ROI 以主播默认时薪作为成本基线：贡献流水 / 预估主播成本，万分比。
export function computeStreamerPerformance(
  tasks: PerformanceSourceTask[],
  streamerHourlyRate: number | null,
): PerformanceMetrics {
  const scheduled = tasks.filter((task) => task.status !== "cancelled");
  const live = scheduled.filter((task) => task.systemStartedAt);
  const completed = scheduled.filter((task) => task.status === "completed");

  let totalLiveMinutes = 0;
  let totalRevenueAmount = 0;
  let totalViewers = 0;

  for (const task of live) {
    const minutes = Math.max(
      0,
      task.settlementDuration ?? task.systemDuration ?? 0,
    );
    totalLiveMinutes += minutes;
    totalRevenueAmount += (minutes / 60) * (task.projectHourlyRate ?? 0);
    totalViewers += Math.max(0, task.viewers ?? 0);
  }

  totalRevenueAmount = roundAmount(totalRevenueAmount);

  const estimatedTalentCost =
    streamerHourlyRate != null && streamerHourlyRate > 0
      ? (totalLiveMinutes / 60) * streamerHourlyRate
      : 0;

  return {
    scheduledSessions: scheduled.length,
    liveSessions: live.length,
    completedSessions: completed.length,
    broadcastRateBps:
      scheduled.length > 0
        ? Math.round((live.length / scheduled.length) * 10000)
        : 0,
    totalLiveMinutes,
    totalRevenueAmount,
    avgSessionRevenueAmount:
      live.length > 0 ? roundAmount(totalRevenueAmount / live.length) : 0,
    avgSessionRoiBps:
      estimatedTalentCost > 0
        ? Math.round((totalRevenueAmount / estimatedTalentCost) * 10000)
        : null,
    totalViewers,
    avgSessionViewers:
      live.length > 0 ? Math.round(totalViewers / live.length) : 0,
  };
}

function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

export const OPERATION_TIERS = [
  "unassigned",
  "core",
  "potential",
  "regular",
  "observation",
] as const;
export type OperationTier = (typeof OPERATION_TIERS)[number];

export type OperationTierPlan = {
  tier: OperationTier;
  tags: string[];
  resourceFocus: string;
  trainingPlan: string;
  suggestedShareBps: number;
};

export type OperationTierInput = {
  broadcastRateBps: number;
  liveSessions: number;
  avgSessionRevenueAmount: number;
};

// 分层规则：按最近绩效快照自动打标，匹配资源倾斜、培训计划与建议分成档位。
export function resolveOperationTier(
  input: OperationTierInput,
): OperationTierPlan {
  const tags: string[] = [];

  if (input.broadcastRateBps >= 9000) {
    tags.push("高开播率");
  } else if (input.broadcastRateBps < 6000) {
    tags.push("低开播率");
  }

  if (input.avgSessionRevenueAmount >= 1000) {
    tags.push("高场均流水");
  }

  if (
    input.broadcastRateBps >= 9000 &&
    input.avgSessionRevenueAmount >= 1000 &&
    input.liveSessions >= 12
  ) {
    return {
      tier: "core",
      tags: ["核心主播", ...tags],
      resourceFocus: "优先匹配高单价项目与黄金时段排期",
      trainingPlan: "进阶复盘：一对一运营复盘与大场策划",
      suggestedShareBps: 7000,
    };
  }

  if (input.broadcastRateBps >= 8000 && input.avgSessionRevenueAmount >= 500) {
    return {
      tier: "potential",
      tags: ["潜力主播", ...tags],
      resourceFocus: "增加优质项目曝光并安排流量扶持位",
      trainingPlan: "重点培养：话术与互动专项训练",
      suggestedShareBps: 6000,
    };
  }

  if (input.broadcastRateBps < 6000 || input.liveSessions < 4) {
    return {
      tier: "observation",
      tags: ["观察名单", ...tags],
      resourceFocus: "暂缓新项目分配，保留基础排期",
      trainingPlan: "限期改进：出勤与开播率专项辅导",
      suggestedShareBps: 4000,
    };
  }

  return {
    tier: "regular",
    tags: ["常规主播", ...tags],
    resourceFocus: "按常规节奏分配项目排期",
    trainingPlan: "常规培训：月度直播技能课",
    suggestedShareBps: 5000,
  };
}
