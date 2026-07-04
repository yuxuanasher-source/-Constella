import type { AuditLogInput } from "@/lib/audit/audit";
import type { NotificationInput } from "@/lib/notify/notify";
import type { AppRole } from "@/lib/rbac/roles";

import {
  assertLifecycleStageTransition,
  assertShiftChangeTransition,
  computeStreamerPerformance,
  deriveAttendanceFromTask,
  resolveOperationTier,
  ATTENDANCE_STATUSES,
  STREAMER_ASSESSMENT_TYPES,
  STREAMER_LIFECYCLE_STAGES,
  STREAMER_RATINGS,
  SHIFT_CHANGE_TYPES,
  type AttendanceCandidateTask,
  type AttendanceStatus,
  type OperationTierPlan,
  type PerformanceSourceTask,
  type ShiftChangeStatus,
  type ShiftChangeType,
  type StreamerAssessmentType,
  type StreamerLifecycleStage,
  type StreamerRating,
} from "./streamer-lifecycle-state";

export type StreamerLifecycleActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
  streamerId?: string | null;
};

export type StreamerLifecycleRecord = {
  id: string;
  displayName: string;
  userId: string | null;
  riskLevel: string;
  lifecycleStage: StreamerLifecycleStage;
  rating: StreamerRating;
  contractStartDate: string | null;
  contractEndDate: string | null;
  revenueShareBps: number | null;
  operationTier: string;
  operationTags: string[];
  defaultHourlyRate: number | null;
};

export type StreamerAssessmentRecord = {
  id: string;
  streamerId: string;
  projectId: string | null;
  liveTaskId: string | null;
  assessmentType: StreamerAssessmentType;
  title: string;
  status: "pending" | "passed" | "failed";
  score: number | null;
  conclusion: string;
  scheduledAt: string | null;
  concludedAt: string | null;
};

export type AttendanceRecordInput = {
  organizationId: string;
  streamerId: string;
  liveTaskId: string;
  projectId: string | null;
  attendanceStatus: AttendanceStatus;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  actualStartAt: string | null;
  actualStopAt: string | null;
  lateMinutes: number;
  liveMinutes: number;
  source: "auto" | "manual";
  note?: string | null;
  createdBy?: string | null;
};

export type ShiftChangeRequestRecord = {
  id: string;
  liveTaskId: string;
  projectId: string | null;
  streamerId: string;
  requestType: ShiftChangeType;
  proposedStartAt: string | null;
  proposedEndAt: string | null;
  substituteStreamerId: string | null;
  reason: string;
  status: ShiftChangeStatus;
  reviewNote: string | null;
};

export type LiveTaskForLifecycle = {
  id: string;
  organizationId: string;
  projectId: string | null;
  streamerId: string;
  status: string;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
};

export type PerformanceSnapshotRecord = {
  id: string;
  streamerId: string;
  periodStart: string;
  periodEnd: string;
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
  computedAt: string;
};

export type LifecycleEventInput = {
  organizationId: string;
  streamerId: string;
  eventType:
    | "stage_change"
    | "rating_change"
    | "tier_change"
    | "contract_change"
    | "assessment_concluded"
    | "shift_change_applied";
  fromValue?: string | null;
  toValue?: string | null;
  reason?: string | null;
  detail?: Record<string, unknown>;
  createdBy?: string | null;
};

export type StreamerLifecycleRepository = {
  getStreamerLifecycle(
    streamerId: string,
  ): Promise<StreamerLifecycleRecord | null>;
  updateStreamerLifecycle(
    streamerId: string,
    patch: {
      lifecycle_stage?: StreamerLifecycleStage;
      lifecycle_stage_changed_at?: string;
      rating?: StreamerRating;
      contract_start_date?: string | null;
      contract_end_date?: string | null;
      revenue_share_bps?: number | null;
      operation_tier?: string;
      operation_tags?: string[];
    },
  ): Promise<StreamerLifecycleRecord>;
  insertLifecycleEvent(input: LifecycleEventInput): Promise<void>;
  createAssessment(input: {
    organizationId: string;
    streamerId: string;
    projectId?: string | null;
    liveTaskId?: string | null;
    assessmentType: StreamerAssessmentType;
    title: string;
    scheduledAt?: string | null;
    createdBy: string;
  }): Promise<StreamerAssessmentRecord>;
  getAssessmentById(
    assessmentId: string,
  ): Promise<StreamerAssessmentRecord | null>;
  concludeAssessment(
    assessmentId: string,
    patch: {
      status: "passed" | "failed";
      score?: number | null;
      conclusion?: string;
      evaluator_id: string;
      concluded_at: string;
    },
  ): Promise<StreamerAssessmentRecord>;
  listAttendanceCandidateTasks(
    organizationId: string,
    until: string,
  ): Promise<AttendanceCandidateTask[]>;
  insertAttendanceRecords(records: AttendanceRecordInput[]): Promise<number>;
  upsertManualAttendance(record: AttendanceRecordInput): Promise<void>;
  getLiveTaskById(taskId: string): Promise<LiveTaskForLifecycle | null>;
  getProjectStreamerStatus(
    projectId: string,
    streamerId: string,
  ): Promise<string | null>;
  createShiftChangeRequest(input: {
    organizationId: string;
    liveTaskId: string;
    projectId: string | null;
    streamerId: string;
    requestType: ShiftChangeType;
    proposedStartAt?: string | null;
    proposedEndAt?: string | null;
    substituteStreamerId?: string | null;
    reason: string;
    createdBy: string;
  }): Promise<ShiftChangeRequestRecord>;
  getShiftChangeRequestById(
    requestId: string,
  ): Promise<ShiftChangeRequestRecord | null>;
  updateShiftChangeRequest(
    requestId: string,
    patch: {
      status: ShiftChangeStatus;
      reviewed_by?: string;
      reviewed_at?: string;
      review_note?: string | null;
    },
  ): Promise<ShiftChangeRequestRecord>;
  updateLiveTaskSchedule(
    taskId: string,
    patch: {
      planned_start_at?: string;
      planned_end_at?: string;
      planned_duration?: number;
      streamer_id?: string;
    },
  ): Promise<void>;
  listPerformanceSourceTasks(
    organizationId: string,
    streamerId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<PerformanceSourceTask[]>;
  upsertPerformanceSnapshot(input: {
    organizationId: string;
    streamerId: string;
    periodStart: string;
    periodEnd: string;
    metrics: {
      scheduled_sessions: number;
      live_sessions: number;
      completed_sessions: number;
      broadcast_rate_bps: number;
      total_live_minutes: number;
      total_revenue_amount: number;
      avg_session_revenue_amount: number;
      avg_session_roi_bps: number | null;
      total_viewers: number;
      avg_session_viewers: number;
    };
    createdBy: string;
  }): Promise<PerformanceSnapshotRecord>;
  getLatestPerformanceSnapshot(
    streamerId: string,
  ): Promise<PerformanceSnapshotRecord | null>;
};

export type StreamerLifecycleAuditWriter = (
  input: AuditLogInput,
) => Promise<void>;
export type StreamerLifecycleNotifier = (
  input: NotificationInput,
) => Promise<void>;

function canGovernStreamerLifecycle(role: AppRole): boolean {
  return role === "owner" || role === "ops_manager";
}

function canOperateStreamerLifecycle(role: AppRole): boolean {
  return (
    role === "owner" || role === "ops_manager" || role === "operator_business"
  );
}

async function getStreamerOrThrow(
  repo: StreamerLifecycleRepository,
  streamerId: string,
): Promise<StreamerLifecycleRecord> {
  const streamer = await repo.getStreamerLifecycle(streamerId);
  if (!streamer) {
    throw new Error("Streamer not found");
  }
  return streamer;
}

function baseAudit(actor: StreamerLifecycleActor) {
  return {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    module: "streamer_lifecycle",
  } as const;
}

export async function changeStreamerLifecycleStage({
  repo,
  audit,
  notify,
  actor,
  streamerId,
  input,
  reason,
}: {
  repo: StreamerLifecycleRepository;
  audit: StreamerLifecycleAuditWriter;
  notify?: StreamerLifecycleNotifier;
  actor: StreamerLifecycleActor;
  streamerId: string;
  input: { stage: StreamerLifecycleStage };
  reason: string;
}): Promise<StreamerLifecycleRecord> {
  if (!canGovernStreamerLifecycle(actor.role)) {
    throw new Error(
      "Only owner and ops_manager can change streamer lifecycle stage",
    );
  }
  if (!STREAMER_LIFECYCLE_STAGES.includes(input.stage)) {
    throw new Error("Unknown lifecycle stage");
  }
  if (!reason.trim()) {
    throw new Error("Streamer lifecycle stage changes require a reason");
  }

  const before = await getStreamerOrThrow(repo, streamerId);
  assertLifecycleStageTransition(before.lifecycleStage, input.stage);

  const streamer = await repo.updateStreamerLifecycle(streamerId, {
    lifecycle_stage: input.stage,
    lifecycle_stage_changed_at: new Date().toISOString(),
  });

  await repo.insertLifecycleEvent({
    organizationId: actor.organizationId,
    streamerId,
    eventType: "stage_change",
    fromValue: before.lifecycleStage,
    toValue: input.stage,
    reason: reason.trim(),
    createdBy: actor.userId,
  });

  await audit({
    ...baseAudit(actor),
    action: "update",
    objectType: "streamer",
    objectId: streamerId,
    objectName: streamer.displayName,
    streamerId,
    before: { lifecycleStage: before.lifecycleStage },
    after: { lifecycleStage: streamer.lifecycleStage },
    changedFields: ["lifecycle_stage"],
    isHighRisk: input.stage === "eliminated",
    reason: reason.trim(),
  });

  if (notify && streamer.userId) {
    await notify({
      organizationId: actor.organizationId,
      recipientUserId: streamer.userId,
      type: "system",
      title: "主播生命周期阶段更新",
      content: `你的合作阶段已从「${before.lifecycleStage}」调整为「${streamer.lifecycleStage}」。`,
      objectType: "streamer",
      objectId: streamerId,
      source: "streamer_lifecycle",
    });
  }

  return streamer;
}

export async function updateStreamerRating({
  repo,
  audit,
  actor,
  streamerId,
  input,
  reason,
}: {
  repo: StreamerLifecycleRepository;
  audit: StreamerLifecycleAuditWriter;
  actor: StreamerLifecycleActor;
  streamerId: string;
  input: { rating: StreamerRating };
  reason: string;
}): Promise<StreamerLifecycleRecord> {
  if (!canGovernStreamerLifecycle(actor.role)) {
    throw new Error("Only owner and ops_manager can update streamer rating");
  }
  if (!STREAMER_RATINGS.includes(input.rating)) {
    throw new Error("Unknown streamer rating");
  }
  if (!reason.trim()) {
    throw new Error("Streamer rating changes require a reason");
  }

  const before = await getStreamerOrThrow(repo, streamerId);
  const streamer = await repo.updateStreamerLifecycle(streamerId, {
    rating: input.rating,
  });

  await repo.insertLifecycleEvent({
    organizationId: actor.organizationId,
    streamerId,
    eventType: "rating_change",
    fromValue: before.rating,
    toValue: input.rating,
    reason: reason.trim(),
    createdBy: actor.userId,
  });

  await audit({
    ...baseAudit(actor),
    action: "update",
    objectType: "streamer",
    objectId: streamerId,
    objectName: streamer.displayName,
    streamerId,
    before: { rating: before.rating },
    after: { rating: streamer.rating },
    changedFields: ["rating"],
    reason: reason.trim(),
  });

  return streamer;
}

export async function updateStreamerContract({
  repo,
  audit,
  actor,
  streamerId,
  input,
  reason,
}: {
  repo: StreamerLifecycleRepository;
  audit: StreamerLifecycleAuditWriter;
  actor: StreamerLifecycleActor;
  streamerId: string;
  input: {
    contractStartDate?: string | null;
    contractEndDate?: string | null;
    revenueShareBps?: number | null;
  };
  reason: string;
}): Promise<StreamerLifecycleRecord> {
  if (!canGovernStreamerLifecycle(actor.role)) {
    throw new Error("Only owner and ops_manager can update streamer contract");
  }
  if (!reason.trim()) {
    throw new Error("Streamer contract changes require a reason");
  }

  if (
    input.revenueShareBps != null &&
    (!Number.isInteger(input.revenueShareBps) ||
      input.revenueShareBps < 0 ||
      input.revenueShareBps > 10000)
  ) {
    throw new Error("revenueShareBps must be between 0 and 10000");
  }

  const patch = removeUndefined({
    contract_start_date: normalizeDate(
      input.contractStartDate,
      "contractStartDate",
    ),
    contract_end_date: normalizeDate(input.contractEndDate, "contractEndDate"),
    revenue_share_bps: input.revenueShareBps,
  });
  if (Object.keys(patch).length === 0) {
    throw new Error("No streamer contract changes provided");
  }

  const before = await getStreamerOrThrow(repo, streamerId);

  const nextStart =
    patch.contract_start_date !== undefined
      ? patch.contract_start_date
      : before.contractStartDate;
  const nextEnd =
    patch.contract_end_date !== undefined
      ? patch.contract_end_date
      : before.contractEndDate;
  if (nextStart && nextEnd && nextEnd < nextStart) {
    throw new Error("contractEndDate cannot be earlier than contractStartDate");
  }

  const streamer = await repo.updateStreamerLifecycle(streamerId, patch);

  await repo.insertLifecycleEvent({
    organizationId: actor.organizationId,
    streamerId,
    eventType: "contract_change",
    fromValue: contractSummary(before),
    toValue: contractSummary(streamer),
    reason: reason.trim(),
    createdBy: actor.userId,
  });

  await audit({
    ...baseAudit(actor),
    action: "update",
    objectType: "streamer",
    objectId: streamerId,
    objectName: streamer.displayName,
    streamerId,
    before: {
      contractStartDate: before.contractStartDate,
      contractEndDate: before.contractEndDate,
      revenueShareBps: before.revenueShareBps,
    },
    after: {
      contractStartDate: streamer.contractStartDate,
      contractEndDate: streamer.contractEndDate,
      revenueShareBps: streamer.revenueShareBps,
    },
    changedFields: Object.keys(patch),
    isHighRisk: true,
    reason: reason.trim(),
  });

  return streamer;
}

function contractSummary(streamer: StreamerLifecycleRecord): string {
  return `${streamer.contractStartDate ?? "-"}~${streamer.contractEndDate ?? "-"}@${streamer.revenueShareBps ?? "-"}bps`;
}

export async function createStreamerAssessment({
  repo,
  audit,
  actor,
  streamerId,
  input,
}: {
  repo: StreamerLifecycleRepository;
  audit: StreamerLifecycleAuditWriter;
  actor: StreamerLifecycleActor;
  streamerId: string;
  input: {
    assessmentType: StreamerAssessmentType;
    title: string;
    projectId?: string | null;
    liveTaskId?: string | null;
    scheduledAt?: string | null;
  };
}): Promise<StreamerAssessmentRecord> {
  if (!canOperateStreamerLifecycle(actor.role)) {
    throw new Error("Current role cannot manage streamer assessments");
  }
  if (!STREAMER_ASSESSMENT_TYPES.includes(input.assessmentType)) {
    throw new Error("Unknown assessment type");
  }
  const title = input.title.trim();
  if (!title) {
    throw new Error("title is required");
  }

  const streamer = await getStreamerOrThrow(repo, streamerId);
  if (streamer.lifecycleStage === "eliminated") {
    throw new Error("Eliminated streamers cannot be assessed");
  }

  const assessment = await repo.createAssessment({
    organizationId: actor.organizationId,
    streamerId,
    projectId: input.projectId ?? null,
    liveTaskId: input.liveTaskId ?? null,
    assessmentType: input.assessmentType,
    title,
    scheduledAt: input.scheduledAt ?? null,
    createdBy: actor.userId,
  });

  await audit({
    ...baseAudit(actor),
    action: "create",
    objectType: "streamer_assessment",
    objectId: assessment.id,
    objectName: assessment.title,
    streamerId,
    after: {
      assessmentType: assessment.assessmentType,
      title: assessment.title,
    },
    changedFields: ["assessment_type", "title"],
  });

  return assessment;
}

export async function concludeStreamerAssessment({
  repo,
  audit,
  notify,
  actor,
  assessmentId,
  input,
}: {
  repo: StreamerLifecycleRepository;
  audit: StreamerLifecycleAuditWriter;
  notify?: StreamerLifecycleNotifier;
  actor: StreamerLifecycleActor;
  assessmentId: string;
  input: {
    result: "passed" | "failed";
    score?: number | null;
    conclusion?: string;
  };
}): Promise<StreamerAssessmentRecord> {
  if (!canOperateStreamerLifecycle(actor.role)) {
    throw new Error("Current role cannot manage streamer assessments");
  }
  if (input.result !== "passed" && input.result !== "failed") {
    throw new Error("result must be passed or failed");
  }
  if (
    input.score != null &&
    (!Number.isInteger(input.score) || input.score < 0 || input.score > 100)
  ) {
    throw new Error("score must be between 0 and 100");
  }

  const assessment = await repo.getAssessmentById(assessmentId);
  if (!assessment) {
    throw new Error("Assessment not found");
  }
  if (assessment.status !== "pending") {
    throw new Error("Assessment is already concluded");
  }
  if (
    assessment.assessmentType === "probation" &&
    !canGovernStreamerLifecycle(actor.role)
  ) {
    throw new Error(
      "Only owner and ops_manager can conclude probation assessments",
    );
  }

  const streamer = await getStreamerOrThrow(repo, assessment.streamerId);

  const concluded = await repo.concludeAssessment(assessmentId, {
    status: input.result,
    score: input.score ?? null,
    conclusion: input.conclusion?.trim() ?? "",
    evaluator_id: actor.userId,
    concluded_at: new Date().toISOString(),
  });

  await repo.insertLifecycleEvent({
    organizationId: actor.organizationId,
    streamerId: assessment.streamerId,
    eventType: "assessment_concluded",
    fromValue: assessment.assessmentType,
    toValue: input.result,
    reason: input.conclusion?.trim() || null,
    detail: { assessmentId, score: input.score ?? null },
    createdBy: actor.userId,
  });

  await audit({
    ...baseAudit(actor),
    action: input.result === "passed" ? "approve" : "reject",
    objectType: "streamer_assessment",
    objectId: assessmentId,
    objectName: assessment.title,
    streamerId: assessment.streamerId,
    before: { status: assessment.status },
    after: { status: concluded.status, score: concluded.score },
    changedFields: ["status", "score", "conclusion"],
  });

  // 转正评估通过：试播 / 培训期主播自动转正。
  if (
    assessment.assessmentType === "probation" &&
    input.result === "passed" &&
    (streamer.lifecycleStage === "trial" ||
      streamer.lifecycleStage === "training")
  ) {
    const promoted = await repo.updateStreamerLifecycle(assessment.streamerId, {
      lifecycle_stage: "regular",
      lifecycle_stage_changed_at: new Date().toISOString(),
    });

    await repo.insertLifecycleEvent({
      organizationId: actor.organizationId,
      streamerId: assessment.streamerId,
      eventType: "stage_change",
      fromValue: streamer.lifecycleStage,
      toValue: "regular",
      reason: "转正评估通过",
      detail: { assessmentId },
      createdBy: actor.userId,
    });

    await audit({
      ...baseAudit(actor),
      action: "update",
      objectType: "streamer",
      objectId: assessment.streamerId,
      objectName: promoted.displayName,
      streamerId: assessment.streamerId,
      before: { lifecycleStage: streamer.lifecycleStage },
      after: { lifecycleStage: promoted.lifecycleStage },
      changedFields: ["lifecycle_stage"],
      reason: "转正评估通过",
    });
  }

  if (notify && streamer.userId) {
    await notify({
      organizationId: actor.organizationId,
      recipientUserId: streamer.userId,
      type: "review",
      title: "考核结果已出",
      content: `「${assessment.title}」考核结果：${input.result === "passed" ? "通过" : "未通过"}。`,
      objectType: "streamer_assessment",
      objectId: assessmentId,
      source: "streamer_lifecycle",
    });
  }

  return concluded;
}

export async function generateAttendanceRecords({
  repo,
  audit,
  actor,
  input,
}: {
  repo: StreamerLifecycleRepository;
  audit: StreamerLifecycleAuditWriter;
  actor: StreamerLifecycleActor;
  input?: { until?: string };
}): Promise<{ generated: number; scanned: number }> {
  if (!canOperateStreamerLifecycle(actor.role)) {
    throw new Error("Current role cannot manage streamer attendance");
  }

  const until = input?.until ? new Date(input.until) : new Date();
  if (Number.isNaN(until.getTime())) {
    throw new Error("until must be a valid timestamp");
  }

  const candidates = await repo.listAttendanceCandidateTasks(
    actor.organizationId,
    until.toISOString(),
  );

  const records: AttendanceRecordInput[] = [];
  for (const task of candidates) {
    const derived = deriveAttendanceFromTask(task, until);
    if (!derived) {
      continue;
    }
    records.push({
      organizationId: actor.organizationId,
      streamerId: task.streamerId,
      liveTaskId: task.taskId,
      projectId: task.projectId,
      attendanceStatus: derived.attendanceStatus,
      plannedStartAt: task.plannedStartAt,
      plannedEndAt: task.plannedEndAt,
      actualStartAt: task.systemStartedAt,
      actualStopAt: task.systemStoppedAt,
      lateMinutes: derived.lateMinutes,
      liveMinutes: derived.liveMinutes,
      source: "auto",
      createdBy: actor.userId,
    });
  }

  const generated =
    records.length > 0 ? await repo.insertAttendanceRecords(records) : 0;

  if (generated > 0) {
    await audit({
      ...baseAudit(actor),
      action: "create",
      objectType: "streamer_attendance",
      after: { generated, scanned: candidates.length },
      changedFields: ["attendance_status"],
    });
  }

  return { generated, scanned: candidates.length };
}

export async function recordManualAttendance({
  repo,
  audit,
  actor,
  input,
  reason,
}: {
  repo: StreamerLifecycleRepository;
  audit: StreamerLifecycleAuditWriter;
  actor: StreamerLifecycleActor;
  input: {
    liveTaskId: string;
    attendanceStatus: AttendanceStatus;
    lateMinutes?: number;
    note?: string;
  };
  reason: string;
}): Promise<void> {
  if (!canOperateStreamerLifecycle(actor.role)) {
    throw new Error("Current role cannot manage streamer attendance");
  }
  if (!ATTENDANCE_STATUSES.includes(input.attendanceStatus)) {
    throw new Error("Unknown attendance status");
  }
  if (
    input.lateMinutes != null &&
    (!Number.isInteger(input.lateMinutes) || input.lateMinutes < 0)
  ) {
    throw new Error("lateMinutes must be a non-negative integer");
  }
  if (!reason.trim()) {
    throw new Error("Manual attendance corrections require a reason");
  }

  const task = await repo.getLiveTaskById(input.liveTaskId);
  if (!task || task.organizationId !== actor.organizationId) {
    throw new Error("Live task not found");
  }

  await repo.upsertManualAttendance({
    organizationId: actor.organizationId,
    streamerId: task.streamerId,
    liveTaskId: task.id,
    projectId: task.projectId,
    attendanceStatus: input.attendanceStatus,
    plannedStartAt: task.plannedStartAt,
    plannedEndAt: task.plannedEndAt,
    actualStartAt: null,
    actualStopAt: null,
    lateMinutes: input.lateMinutes ?? 0,
    liveMinutes: 0,
    source: "manual",
    note: input.note?.trim() || null,
    createdBy: actor.userId,
  });

  await audit({
    ...baseAudit(actor),
    action: "update",
    objectType: "streamer_attendance",
    objectId: task.id,
    streamerId: task.streamerId,
    after: {
      attendanceStatus: input.attendanceStatus,
      lateMinutes: input.lateMinutes ?? 0,
    },
    changedFields: ["attendance_status", "late_minutes", "note"],
    reason: reason.trim(),
  });
}

export async function createShiftChangeRequest({
  repo,
  audit,
  notify,
  actor,
  input,
}: {
  repo: StreamerLifecycleRepository;
  audit: StreamerLifecycleAuditWriter;
  notify?: StreamerLifecycleNotifier;
  actor: StreamerLifecycleActor;
  input: {
    liveTaskId: string;
    requestType: ShiftChangeType;
    proposedStartAt?: string | null;
    proposedEndAt?: string | null;
    substituteStreamerId?: string | null;
    reason: string;
  };
}): Promise<ShiftChangeRequestRecord> {
  if (actor.role !== "streamer" && !canOperateStreamerLifecycle(actor.role)) {
    throw new Error("Current role cannot manage shift change requests");
  }
  if (!SHIFT_CHANGE_TYPES.includes(input.requestType)) {
    throw new Error("Unknown shift change request type");
  }
  if (!input.reason.trim()) {
    throw new Error("Shift change requests require a reason");
  }

  const task = await repo.getLiveTaskById(input.liveTaskId);
  if (!task || task.organizationId !== actor.organizationId) {
    throw new Error("Live task not found");
  }
  if (task.status !== "pending_live") {
    throw new Error("Only pending live tasks can request a shift change");
  }
  if (actor.role === "streamer" && task.streamerId !== actor.streamerId) {
    throw new Error(
      "Streamers can only request shift changes for their own tasks",
    );
  }

  if (input.requestType === "reschedule") {
    if (!input.proposedStartAt || !input.proposedEndAt) {
      throw new Error(
        "Reschedule requests require proposedStartAt and proposedEndAt",
      );
    }
    if (new Date(input.proposedEndAt) <= new Date(input.proposedStartAt)) {
      throw new Error("proposedEndAt must be later than proposedStartAt");
    }
  }

  if (input.requestType === "substitute") {
    if (!input.substituteStreamerId) {
      throw new Error("Substitute requests require substituteStreamerId");
    }
    if (input.substituteStreamerId === task.streamerId) {
      throw new Error("Substitute streamer must differ from the current one");
    }
    const substitute = await repo.getStreamerLifecycle(
      input.substituteStreamerId,
    );
    if (!substitute) {
      throw new Error("Substitute streamer not found");
    }
    if (substitute.riskLevel === "blacklisted") {
      throw new Error("Blacklisted streamers cannot take substitute shifts");
    }
    if (substitute.lifecycleStage === "eliminated") {
      throw new Error("Eliminated streamers cannot take substitute shifts");
    }
    if (task.projectId) {
      const memberStatus = await repo.getProjectStreamerStatus(
        task.projectId,
        input.substituteStreamerId,
      );
      if (memberStatus !== "joined") {
        throw new Error("Substitute streamer has not joined the project");
      }
    }
  }

  const request = await repo.createShiftChangeRequest({
    organizationId: actor.organizationId,
    liveTaskId: task.id,
    projectId: task.projectId,
    streamerId: task.streamerId,
    requestType: input.requestType,
    proposedStartAt:
      input.requestType === "reschedule" ? input.proposedStartAt : null,
    proposedEndAt:
      input.requestType === "reschedule" ? input.proposedEndAt : null,
    substituteStreamerId:
      input.requestType === "substitute" ? input.substituteStreamerId : null,
    reason: input.reason.trim(),
    createdBy: actor.userId,
  });

  await audit({
    ...baseAudit(actor),
    action: "create",
    objectType: "shift_change_request",
    objectId: request.id,
    projectId: task.projectId ?? undefined,
    streamerId: task.streamerId,
    after: {
      requestType: request.requestType,
      liveTaskId: request.liveTaskId,
    },
    changedFields: ["request_type", "reason"],
  });

  if (notify) {
    await notify({
      organizationId: actor.organizationId,
      recipientRole: "ops_manager",
      type: "task",
      title: "新的调班/替班申请",
      content: `任务 ${task.id} 收到${request.requestType === "reschedule" ? "调班" : "替班"}申请，等待审批。`,
      objectType: "shift_change_request",
      objectId: request.id,
      source: "streamer_lifecycle",
    });
  }

  return request;
}

export async function reviewShiftChangeRequest({
  repo,
  audit,
  notify,
  actor,
  requestId,
  input,
}: {
  repo: StreamerLifecycleRepository;
  audit: StreamerLifecycleAuditWriter;
  notify?: StreamerLifecycleNotifier;
  actor: StreamerLifecycleActor;
  requestId: string;
  input: { decision: "approved" | "rejected"; reviewNote?: string };
}): Promise<ShiftChangeRequestRecord> {
  if (!canOperateStreamerLifecycle(actor.role)) {
    throw new Error("Current role cannot review shift change requests");
  }
  if (input.decision !== "approved" && input.decision !== "rejected") {
    throw new Error("decision must be approved or rejected");
  }

  const request = await repo.getShiftChangeRequestById(requestId);
  if (!request) {
    throw new Error("Shift change request not found");
  }
  assertShiftChangeTransition(request.status, input.decision);

  if (input.decision === "approved") {
    const task = await repo.getLiveTaskById(request.liveTaskId);
    if (!task || task.status !== "pending_live") {
      throw new Error("Live task is no longer pending live");
    }

    if (request.requestType === "reschedule") {
      if (!request.proposedStartAt || !request.proposedEndAt) {
        throw new Error("Reschedule request is missing a proposed window");
      }
      const plannedDuration = Math.round(
        (new Date(request.proposedEndAt).getTime() -
          new Date(request.proposedStartAt).getTime()) /
          60000,
      );
      await repo.updateLiveTaskSchedule(task.id, {
        planned_start_at: request.proposedStartAt,
        planned_end_at: request.proposedEndAt,
        planned_duration: plannedDuration,
      });
    } else {
      if (!request.substituteStreamerId) {
        throw new Error("Substitute request is missing a substitute streamer");
      }
      await repo.updateLiveTaskSchedule(task.id, {
        streamer_id: request.substituteStreamerId,
      });
    }

    await repo.insertLifecycleEvent({
      organizationId: actor.organizationId,
      streamerId: request.streamerId,
      eventType: "shift_change_applied",
      fromValue: request.requestType,
      toValue: "approved",
      reason: input.reviewNote?.trim() || null,
      detail: {
        requestId,
        liveTaskId: request.liveTaskId,
        substituteStreamerId: request.substituteStreamerId,
      },
      createdBy: actor.userId,
    });
  }

  const reviewed = await repo.updateShiftChangeRequest(requestId, {
    status: input.decision,
    reviewed_by: actor.userId,
    reviewed_at: new Date().toISOString(),
    review_note: input.reviewNote?.trim() || null,
  });

  await audit({
    ...baseAudit(actor),
    action: input.decision === "approved" ? "approve" : "reject",
    objectType: "shift_change_request",
    objectId: requestId,
    projectId: request.projectId ?? undefined,
    streamerId: request.streamerId,
    before: { status: request.status },
    after: { status: reviewed.status },
    changedFields: ["status", "review_note"],
  });

  if (notify) {
    const requester = await repo.getStreamerLifecycle(request.streamerId);
    if (requester?.userId) {
      await notify({
        organizationId: actor.organizationId,
        recipientUserId: requester.userId,
        type: "task",
        title: "调班/替班申请已审批",
        content: `你的${request.requestType === "reschedule" ? "调班" : "替班"}申请${input.decision === "approved" ? "已通过" : "被驳回"}。`,
        objectType: "shift_change_request",
        objectId: requestId,
        source: "streamer_lifecycle",
      });
    }
  }

  return reviewed;
}

export async function cancelShiftChangeRequest({
  repo,
  audit,
  actor,
  requestId,
}: {
  repo: StreamerLifecycleRepository;
  audit: StreamerLifecycleAuditWriter;
  actor: StreamerLifecycleActor;
  requestId: string;
}): Promise<ShiftChangeRequestRecord> {
  const request = await repo.getShiftChangeRequestById(requestId);
  if (!request) {
    throw new Error("Shift change request not found");
  }
  if (actor.role === "streamer") {
    if (request.streamerId !== actor.streamerId) {
      throw new Error("Streamers can only cancel their own requests");
    }
  } else if (!canOperateStreamerLifecycle(actor.role)) {
    throw new Error("Current role cannot manage shift change requests");
  }

  assertShiftChangeTransition(request.status, "cancelled");

  const cancelled = await repo.updateShiftChangeRequest(requestId, {
    status: "cancelled",
  });

  await audit({
    ...baseAudit(actor),
    action: "update",
    objectType: "shift_change_request",
    objectId: requestId,
    streamerId: request.streamerId,
    before: { status: request.status },
    after: { status: cancelled.status },
    changedFields: ["status"],
  });

  return cancelled;
}

export async function syncStreamerPerformance({
  repo,
  audit,
  actor,
  streamerId,
  input,
}: {
  repo: StreamerLifecycleRepository;
  audit: StreamerLifecycleAuditWriter;
  actor: StreamerLifecycleActor;
  streamerId: string;
  input: { periodStart: string; periodEnd: string };
}): Promise<PerformanceSnapshotRecord> {
  if (!canOperateStreamerLifecycle(actor.role)) {
    throw new Error("Current role cannot sync streamer performance");
  }

  const periodStart = normalizeDate(input.periodStart, "periodStart");
  const periodEnd = normalizeDate(input.periodEnd, "periodEnd");
  if (!periodStart || !periodEnd) {
    throw new Error("periodStart and periodEnd are required");
  }
  if (periodEnd < periodStart) {
    throw new Error("periodEnd cannot be earlier than periodStart");
  }

  const streamer = await getStreamerOrThrow(repo, streamerId);
  const tasks = await repo.listPerformanceSourceTasks(
    actor.organizationId,
    streamerId,
    periodStart,
    periodEnd,
  );

  const metrics = computeStreamerPerformance(tasks, streamer.defaultHourlyRate);

  const snapshot = await repo.upsertPerformanceSnapshot({
    organizationId: actor.organizationId,
    streamerId,
    periodStart,
    periodEnd,
    metrics: {
      scheduled_sessions: metrics.scheduledSessions,
      live_sessions: metrics.liveSessions,
      completed_sessions: metrics.completedSessions,
      broadcast_rate_bps: metrics.broadcastRateBps,
      total_live_minutes: metrics.totalLiveMinutes,
      total_revenue_amount: metrics.totalRevenueAmount,
      avg_session_revenue_amount: metrics.avgSessionRevenueAmount,
      avg_session_roi_bps: metrics.avgSessionRoiBps,
      total_viewers: metrics.totalViewers,
      avg_session_viewers: metrics.avgSessionViewers,
    },
    createdBy: actor.userId,
  });

  await audit({
    ...baseAudit(actor),
    action: "update",
    objectType: "streamer_performance_snapshot",
    objectId: snapshot.id,
    streamerId,
    after: {
      periodStart,
      periodEnd,
      broadcastRateBps: metrics.broadcastRateBps,
      liveSessions: metrics.liveSessions,
    },
    changedFields: ["performance_snapshot"],
  });

  return snapshot;
}

export async function applyStreamerOperationTier({
  repo,
  audit,
  actor,
  streamerId,
}: {
  repo: StreamerLifecycleRepository;
  audit: StreamerLifecycleAuditWriter;
  actor: StreamerLifecycleActor;
  streamerId: string;
}): Promise<{ streamer: StreamerLifecycleRecord; plan: OperationTierPlan }> {
  if (!canGovernStreamerLifecycle(actor.role)) {
    throw new Error(
      "Only owner and ops_manager can adjust streamer operation tiers",
    );
  }

  const before = await getStreamerOrThrow(repo, streamerId);
  const snapshot = await repo.getLatestPerformanceSnapshot(streamerId);
  if (!snapshot) {
    throw new Error(
      "No performance snapshot available; sync streamer performance first",
    );
  }

  const plan = resolveOperationTier({
    broadcastRateBps: snapshot.broadcastRateBps,
    liveSessions: snapshot.liveSessions,
    avgSessionRevenueAmount: snapshot.avgSessionRevenueAmount,
  });

  const streamer = await repo.updateStreamerLifecycle(streamerId, {
    operation_tier: plan.tier,
    operation_tags: plan.tags,
  });

  if (before.operationTier !== plan.tier) {
    await repo.insertLifecycleEvent({
      organizationId: actor.organizationId,
      streamerId,
      eventType: "tier_change",
      fromValue: before.operationTier,
      toValue: plan.tier,
      detail: { snapshotId: snapshot.id, tags: plan.tags },
      createdBy: actor.userId,
    });
  }

  await audit({
    ...baseAudit(actor),
    action: "update",
    objectType: "streamer",
    objectId: streamerId,
    objectName: streamer.displayName,
    streamerId,
    before: {
      operationTier: before.operationTier,
      operationTags: before.operationTags,
    },
    after: {
      operationTier: streamer.operationTier,
      operationTags: streamer.operationTags,
    },
    changedFields: ["operation_tier", "operation_tags"],
  });

  return { streamer, plan };
}

function normalizeDate(
  value: string | null | undefined,
  fieldName: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${fieldName} must be a valid date (YYYY-MM-DD)`);
  }
  return value;
}

function removeUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}
