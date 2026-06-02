import type { AuditLogInput } from "@/lib/audit/audit";
import type { NotificationInput } from "@/lib/notify/notify";
import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";

import {
  resolveReportEvidence,
  type EvidenceLevel,
  type TimeSource,
} from "./live-report-evidence";
import {
  assertLiveTaskTransition,
  deriveSystemDurationMinutes,
  type LiveTaskStatus,
} from "./live-task-state";

export type ReportStatus =
  | "pending"
  | "ocr_ing"
  | "pending_confirm"
  | "pending_review"
  | "pending_adjudication"
  | "approved"
  | "rejected"
  | "need_more"
  | "voided";

export type LiveOperationsActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
  streamerId?: string | null;
};

export type ProjectStreamerForTask = {
  id: string;
  projectId: string;
  streamerId: string;
  status:
    | "candidate"
    | "screening"
    | "approved"
    | "rejected"
    | "joined"
    | "removed";
};

export type LiveTaskRecord = {
  id: string;
  organizationId: string;
  projectId: string | null;
  streamerId: string;
  title: string;
  status: LiveTaskStatus;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  plannedDuration?: number | null;
  requiresTiming: boolean;
  systemStartedAt?: string | null;
  systemStoppedAt?: string | null;
  systemDuration: number;
  createdBy?: string | null;
};

export type LiveReportRecord = {
  id: string;
  organizationId: string;
  liveTaskId: string;
  projectId: string;
  streamerId: string;
  status: ReportStatus;
  systemDuration?: number | null;
  screenshotDuration?: number | null;
  claimedDuration?: number | null;
  settlementDuration?: number | null;
  timeSource?: TimeSource | null;
  evidenceLevel?: EvidenceLevel | null;
  divergencePct?: number | null;
  viewers?: number | null;
  includeInTaskResult: boolean;
  enterSettlementPool: boolean;
  riskFlags: string[];
};

export type LiveOperationsRepository = {
  getProjectStreamer(input: {
    projectId: string;
    streamerId: string;
  }): Promise<ProjectStreamerForTask | null>;
  createLiveTask(input: {
    organizationId: string;
    projectId: string;
    streamerId: string;
    title: string;
    plannedStartAt?: string | null;
    plannedEndAt?: string | null;
    plannedDuration?: number | null;
    requiresTiming: boolean;
    createdBy: string;
    note?: string;
  }): Promise<LiveTaskRecord>;
  getLiveTaskById(taskId: string): Promise<LiveTaskRecord | null>;
  updateLiveTask(
    taskId: string,
    patch: Partial<LiveTaskRecord>,
  ): Promise<LiveTaskRecord>;
  createLiveReport(input: {
    organizationId: string;
    liveTaskId: string;
    projectId: string;
    streamerId: string;
    status: ReportStatus;
    systemDuration?: number | null;
    screenshotDuration?: number | null;
    claimedDuration?: number | null;
    settlementDuration: number;
    timeSource: TimeSource;
    evidenceLevel: EvidenceLevel;
    divergencePct?: number | null;
    viewers?: number | null;
    riskFlags: string[];
    createdBy: string;
  }): Promise<LiveReportRecord>;
  getLiveReportById(reportId: string): Promise<LiveReportRecord | null>;
  updateLiveReport(
    reportId: string,
    patch: Partial<LiveReportRecord> & {
      reviewedBy?: string;
      reviewedAt?: string;
      reviewNotes?: string;
    },
  ): Promise<LiveReportRecord>;
  createReportScreenshot(input: {
    organizationId: string;
    liveReportId: string;
    projectId: string;
    streamerId: string;
    storagePath: string;
    fileHash: string;
    uploadedBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  createReportChangeLog(input: {
    organizationId: string;
    liveReportId: string;
    changedBy: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    changedFields: string[];
    reason?: string;
  }): Promise<void>;
};

export type LiveOperationsAuditWriter = (input: AuditLogInput) => Promise<void>;
export type LiveOperationsNotifier = (
  input: NotificationInput,
) => Promise<void>;

export async function createLiveTask({
  repo,
  audit,
  notify,
  actor,
  input,
}: {
  repo: LiveOperationsRepository;
  audit: LiveOperationsAuditWriter;
  notify: LiveOperationsNotifier;
  actor: LiveOperationsActor;
  input: {
    projectId: string;
    streamerId: string;
    title: string;
    plannedStartAt?: string | null;
    plannedEndAt?: string | null;
    plannedDuration?: number | null;
    requiresTiming?: boolean;
    note?: string;
  };
}): Promise<LiveTaskRecord> {
  assertCanManageLiveTasks(actor.role);
  assertScheduleWindow(input.plannedStartAt, input.plannedEndAt);

  const projectStreamer = await repo.getProjectStreamer({
    projectId: input.projectId,
    streamerId: input.streamerId,
  });
  if (!projectStreamer || projectStreamer.status !== "joined") {
    throw new Error("Only joined project streamers can be scheduled");
  }

  const task = await repo.createLiveTask({
    organizationId: actor.organizationId,
    projectId: input.projectId,
    streamerId: input.streamerId,
    title: input.title,
    plannedStartAt: input.plannedStartAt,
    plannedEndAt: input.plannedEndAt,
    plannedDuration: input.plannedDuration,
    requiresTiming: input.requiresTiming ?? true,
    createdBy: actor.userId,
    note: input.note,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "live_task",
    objectType: "live_task",
    objectId: task.id,
    objectName: task.title,
    projectId: task.projectId ?? undefined,
    streamerId: task.streamerId,
    after: task as unknown as Record<string, unknown>,
    changedFields: ["status", "planned_start_at", "planned_end_at"],
  });

  await notify({
    organizationId: actor.organizationId,
    recipientRole: "streamer",
    type: "task",
    title: "New live task",
    content: `${task.title} is scheduled.`,
    objectType: "live_task",
    objectId: task.id,
    source: "live_task.create",
  });

  return task;
}

export async function createLiveTasks({
  repo,
  audit,
  notify,
  actor,
  inputs,
}: {
  repo: LiveOperationsRepository;
  audit: LiveOperationsAuditWriter;
  notify: LiveOperationsNotifier;
  actor: LiveOperationsActor;
  inputs: Array<Parameters<typeof createLiveTask>[0]["input"]>;
}): Promise<LiveTaskRecord[]> {
  const tasks: LiveTaskRecord[] = [];
  for (const input of inputs) {
    tasks.push(await createLiveTask({ repo, audit, notify, actor, input }));
  }

  return tasks;
}

export async function startLiveTask({
  repo,
  audit,
  actor,
  taskId,
  now = new Date().toISOString(),
}: {
  repo: LiveOperationsRepository;
  audit: LiveOperationsAuditWriter;
  actor: LiveOperationsActor;
  taskId: string;
  now?: string;
}): Promise<LiveTaskRecord> {
  const before = await requireLiveTask(repo, taskId);
  assertCanOperateTask(actor, before);
  assertLiveTaskTransition(before.status, "live");

  const task = await repo.updateLiveTask(taskId, {
    status: "live",
    systemStartedAt: now,
    systemStoppedAt: null,
    systemDuration: 0,
  });

  await auditLiveTaskUpdate({
    audit,
    actor,
    before,
    after: task,
    changedFields: ["status", "system_started_at"],
  });

  return task;
}

export async function stopLiveTask({
  repo,
  audit,
  actor,
  taskId,
  now = new Date().toISOString(),
}: {
  repo: LiveOperationsRepository;
  audit: LiveOperationsAuditWriter;
  actor: LiveOperationsActor;
  taskId: string;
  now?: string;
}): Promise<LiveTaskRecord> {
  const before = await requireLiveTask(repo, taskId);
  assertCanOperateTask(actor, before);
  assertLiveTaskTransition(before.status, "pending_report");
  if (!before.systemStartedAt) {
    throw new Error("Cannot stop a task that has no system start time");
  }

  const task = await repo.updateLiveTask(taskId, {
    status: "pending_report",
    systemStoppedAt: now,
    systemDuration: deriveSystemDurationMinutes({
      startedAt: before.systemStartedAt,
      stoppedAt: now,
    }),
  });

  await auditLiveTaskUpdate({
    audit,
    actor,
    before,
    after: task,
    changedFields: ["status", "system_stopped_at", "system_duration"],
  });

  return task;
}

export async function submitLiveReport({
  repo,
  audit,
  notify,
  actor,
  taskId,
  input,
}: {
  repo: LiveOperationsRepository;
  audit: LiveOperationsAuditWriter;
  notify: LiveOperationsNotifier;
  actor: LiveOperationsActor;
  taskId: string;
  input: {
    screenshotStoragePath?: string;
    screenshotFileHash?: string;
    screenshotDuration?: number | null;
    claimedDuration?: number | null;
    viewers?: number | null;
  };
}): Promise<LiveReportRecord> {
  const task = await requireLiveTask(repo, taskId);
  assertCanOperateTask(actor, task);
  if (!["pending_report", "report_rejected"].includes(task.status)) {
    throw new Error("Reports can only be submitted from pending report tasks");
  }

  const evidence = resolveReportEvidence({
    systemDuration: task.systemDuration,
    screenshotDuration: input.screenshotDuration,
    claimedDuration: input.claimedDuration,
  });
  const report = await repo.createLiveReport({
    organizationId: actor.organizationId,
    liveTaskId: task.id,
    projectId: requireProjectId(task),
    streamerId: task.streamerId,
    status: "pending_review",
    systemDuration: task.systemDuration,
    screenshotDuration: input.screenshotDuration,
    claimedDuration: input.claimedDuration,
    settlementDuration: evidence.settlementDuration,
    timeSource: evidence.timeSource,
    evidenceLevel: evidence.evidenceLevel,
    divergencePct: evidence.divergencePct,
    viewers: input.viewers,
    riskFlags: evidence.riskFlags,
    createdBy: actor.userId,
  });

  if (input.screenshotStoragePath && input.screenshotFileHash) {
    await repo.createReportScreenshot({
      organizationId: actor.organizationId,
      liveReportId: report.id,
      projectId: report.projectId,
      streamerId: report.streamerId,
      storagePath: input.screenshotStoragePath,
      fileHash: input.screenshotFileHash,
      uploadedBy: actor.userId,
      metadata: {
        screenshotDuration: input.screenshotDuration,
        viewers: input.viewers,
      },
    });
  }

  const beforeTask = task;
  assertLiveTaskTransition(beforeTask.status, "report_pending_review");
  const afterTask = await repo.updateLiveTask(task.id, {
    status: "report_pending_review",
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "live_report",
    objectType: "live_report",
    objectId: report.id,
    projectId: report.projectId,
    streamerId: report.streamerId,
    after: report as unknown as Record<string, unknown>,
    changedFields: [
      "status",
      "settlement_duration",
      "time_source",
      "evidence_level",
    ],
  });
  await auditLiveTaskUpdate({
    audit,
    actor,
    before: beforeTask,
    after: afterTask,
    changedFields: ["status"],
  });
  await notify({
    organizationId: actor.organizationId,
    recipientRole: "operator_business",
    type: "review",
    title: "Live report pending review",
    content: `${task.title} has a report pending review.`,
    objectType: "live_report",
    objectId: report.id,
    source: "live_report.submit",
  });

  return report;
}

export async function reviewLiveReport({
  repo,
  audit,
  notify,
  actor,
  reportId,
  input,
}: {
  repo: LiveOperationsRepository;
  audit: LiveOperationsAuditWriter;
  notify: LiveOperationsNotifier;
  actor: LiveOperationsActor;
  reportId: string;
  input: {
    decision: "approve" | "reject" | "need_more";
    includeInTaskResult?: boolean;
    enterSettlementPool?: boolean;
    reviewNotes?: string;
    reason?: string;
  };
}): Promise<LiveReportRecord> {
  assertCanReviewReports(actor.role);
  const before = await requireLiveReport(repo, reportId);
  assertSameOrganization(actor, before.organizationId);
  if (
    !["pending_review", "pending_adjudication", "need_more"].includes(
      before.status,
    )
  ) {
    throw new Error("Only pending reports can be reviewed");
  }

  const nextStatus = mapReviewDecision(input.decision);
  const taskBefore = await requireLiveTask(repo, before.liveTaskId);
  assertSameOrganization(actor, taskBefore.organizationId);
  const report = await repo.updateLiveReport(reportId, {
    status: nextStatus,
    includeInTaskResult: input.includeInTaskResult ?? true,
    enterSettlementPool: input.enterSettlementPool ?? true,
    reviewedBy: actor.userId,
    reviewedAt: new Date().toISOString(),
    reviewNotes: input.reviewNotes,
  });

  await repo.createReportChangeLog({
    organizationId: actor.organizationId,
    liveReportId: report.id,
    changedBy: actor.userId,
    before: before as unknown as Record<string, unknown>,
    after: report as unknown as Record<string, unknown>,
    changedFields: [
      "status",
      "include_in_task_result",
      "enter_settlement_pool",
    ],
    reason: input.reason ?? input.reviewNotes,
  });

  if (input.decision === "approve") {
    assertLiveTaskTransition(taskBefore.status, "report_approved");
    const approvedTask = await repo.updateLiveTask(taskBefore.id, {
      status: "report_approved",
    });
    assertLiveTaskTransition(approvedTask.status, "completed");
    await repo.updateLiveTask(taskBefore.id, { status: "completed" });
  } else {
    assertLiveTaskTransition(taskBefore.status, "report_rejected");
    await repo.updateLiveTask(taskBefore.id, { status: "report_rejected" });
  }

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: input.decision === "approve" ? "approve" : "reject",
    module: "live_report",
    objectType: "live_report",
    objectId: report.id,
    projectId: report.projectId,
    streamerId: report.streamerId,
    before: before as unknown as Record<string, unknown>,
    after: report as unknown as Record<string, unknown>,
    changedFields: ["status", "reviewed_at", "reviewed_by"],
    reason: input.reason ?? input.reviewNotes,
  });
  await notify({
    organizationId: actor.organizationId,
    recipientRole: "streamer",
    type: "review",
    title:
      input.decision === "approve"
        ? "Live report approved"
        : "Live report needs attention",
    content:
      input.decision === "approve"
        ? "Your report has entered the settlement pool."
        : "Your report was rejected or needs more information.",
    objectType: "live_report",
    objectId: report.id,
    source: "live_report.review",
  });

  return report;
}

function assertCanManageLiveTasks(role: AppRole): void {
  if (
    role !== "owner" &&
    role !== "ops_manager" &&
    role !== "operator_business"
  ) {
    throw new Error("Current role cannot manage live tasks");
  }
}

function assertCanReviewReports(role: AppRole): void {
  if (
    role !== "owner" &&
    role !== "ops_manager" &&
    role !== "operator_business"
  ) {
    throw new Error("Current role cannot review live reports");
  }
}

function assertCanOperateTask(
  actor: LiveOperationsActor,
  task: LiveTaskRecord,
): void {
  assertSameOrganization(actor, task.organizationId);

  if (isMcnStaff(actor.role)) {
    return;
  }

  if (actor.role !== "streamer") {
    throw new Error("Current role cannot operate live tasks");
  }

  if (!actor.streamerId) {
    throw new Error("Current streamer is not bound to a streamer profile");
  }

  if (actor.streamerId !== task.streamerId) {
    throw new Error("Streamers can only operate their own live tasks");
  }
}

function assertSameOrganization(
  actor: LiveOperationsActor,
  organizationId: string,
): void {
  if (actor.organizationId !== organizationId) {
    throw new Error("Cross-organization access is not allowed");
  }
}

async function requireLiveTask(
  repo: Pick<LiveOperationsRepository, "getLiveTaskById">,
  taskId: string,
): Promise<LiveTaskRecord> {
  const task = await repo.getLiveTaskById(taskId);
  if (!task) {
    throw new Error("Live task not found");
  }

  return task;
}

async function requireLiveReport(
  repo: Pick<LiveOperationsRepository, "getLiveReportById">,
  reportId: string,
): Promise<LiveReportRecord> {
  const report = await repo.getLiveReportById(reportId);
  if (!report) {
    throw new Error("Live report not found");
  }

  return report;
}

function requireProjectId(task: LiveTaskRecord): string {
  if (!task.projectId) {
    throw new Error("Report tasks must be project tasks");
  }

  return task.projectId;
}

function assertScheduleWindow(
  plannedStartAt?: string | null,
  plannedEndAt?: string | null,
): void {
  if (!plannedStartAt || !plannedEndAt) {
    return;
  }

  if (new Date(plannedEndAt).getTime() < new Date(plannedStartAt).getTime()) {
    throw new Error("Planned end time cannot be earlier than start time");
  }
}

function mapReviewDecision(
  decision: "approve" | "reject" | "need_more",
): ReportStatus {
  if (decision === "approve") {
    return "approved";
  }

  return decision === "need_more" ? "need_more" : "rejected";
}

async function auditLiveTaskUpdate({
  audit,
  actor,
  before,
  after,
  changedFields,
}: {
  audit: LiveOperationsAuditWriter;
  actor: LiveOperationsActor;
  before: LiveTaskRecord;
  after: LiveTaskRecord;
  changedFields: string[];
}): Promise<void> {
  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "live_task",
    objectType: "live_task",
    objectId: after.id,
    objectName: after.title,
    projectId: after.projectId ?? undefined,
    streamerId: after.streamerId,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    changedFields,
  });
}
