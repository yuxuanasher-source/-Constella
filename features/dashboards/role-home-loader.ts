import type { SupabaseClient } from "@supabase/supabase-js";

import {
  listOpsLiveReportQueue,
  listOpsLiveTaskQueue,
  type OpsLiveReportQueueItem,
  type OpsLiveTaskQueueItem,
} from "@/features/live-operations/live-operations-queries";
import {
  listNotificationCenterItems,
  type NotificationQueryClient,
} from "@/features/notifications/notification-center-queries";
import {
  listProjects,
  type ProjectListItem,
} from "@/features/projects/project-queries";
import {
  toProjectCardDtos,
  type ProjectCardDto,
} from "@/features/projects/project-ui-dto";
import {
  listOpsSettlementBatches,
  listOpsSettlementPool,
  type OpsSettlementBatchListItem,
  type OpsSettlementPoolItem,
} from "@/features/settlements/settlement-queries";
import type { AuthContext } from "@/lib/auth/context";
import { isMcnStaff } from "@/lib/rbac/roles";

import {
  buildRoleHomeDashboard,
  type DashboardBatchInput,
  type DashboardProjectInput,
  type DashboardReportInput,
  type DashboardSettlementPoolInput,
  type DashboardStaffRole,
  type DashboardTaskInput,
  type RoleHomeDashboardDto,
} from "./role-home";

export async function loadRoleHomeDashboard(input: {
  supabase: SupabaseClient;
  auth: AuthContext;
  now?: string;
}): Promise<RoleHomeDashboardDto> {
  const role = input.auth.role;
  assertDashboardStaffRole(role);
  const now = input.now ?? new Date().toISOString();
  const { periodStart, periodEnd } = currentMonthPeriod(now);
  const organizationId = input.auth.organizationId;
  const notificationClient =
    input.supabase as unknown as NotificationQueryClient;

  const [
    projectRows,
    taskRows,
    reportRows,
    settlementPoolRows,
    batchRows,
    notifications,
  ] = await Promise.all([
    listProjects(input.supabase, { organizationId }),
    listOpsLiveTaskQueue(input.supabase, organizationId),
    listOpsLiveReportQueue(input.supabase, organizationId),
    listOpsSettlementPool(input.supabase, {
      organizationId,
      projectId: null,
      batchType: "payable",
      periodStart,
      periodEnd,
    }),
    listOpsSettlementBatches(input.supabase, organizationId),
    listNotificationCenterItems(
      notificationClient,
      {
        userId: input.auth.userId,
        role,
        organizationId,
      },
      { limit: 20 },
    ),
  ]);
  const scopedRows = scopeRowsForRole(role, input.auth.userId, {
    projectRows,
    taskRows,
    reportRows,
    settlementPoolRows,
    batchRows,
  });
  const projectCards = toProjectCardDtos(scopedRows.projectRows);

  return buildRoleHomeDashboard({
    role,
    userId: input.auth.userId,
    organizationId,
    source: {
      now,
      projects: buildDashboardProjects({
        projectRows: scopedRows.projectRows,
        projectCards,
        taskRows: scopedRows.taskRows,
        reportRows: scopedRows.reportRows,
        settlementPoolRows: scopedRows.settlementPoolRows,
        batchRows: scopedRows.batchRows,
        periodStart,
        periodEnd,
      }),
      tasks: scopedRows.taskRows.map(toDashboardTask),
      reports: scopedRows.reportRows.map(toDashboardReport),
      settlementPool: scopedRows.settlementPoolRows.map(
        toDashboardSettlementPoolItem,
      ),
      batches: scopedRows.batchRows.map(toDashboardBatch),
      notifications,
      auditEntries: [],
    },
  });
}

function assertDashboardStaffRole(
  role: AuthContext["role"],
): asserts role is DashboardStaffRole {
  if (!isMcnStaff(role)) {
    throw new Error("Only MCN staff can view the role dashboard");
  }
}

function currentMonthPeriod(now: string) {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));

  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

function scopeRowsForRole(
  role: DashboardStaffRole,
  userId: string,
  rows: {
    projectRows: ProjectListItem[];
    taskRows: OpsLiveTaskQueueItem[];
    reportRows: OpsLiveReportQueueItem[];
    settlementPoolRows: OpsSettlementPoolItem[];
    batchRows: OpsSettlementBatchListItem[];
  },
) {
  if (role !== "operator_business") {
    return rows;
  }

  const allowedProjects = rows.projectRows.filter((project) =>
    isProjectAssignedToUser(project, userId),
  );
  const allowedProjectIds = new Set(
    allowedProjects.map((project) => project.id),
  );

  return {
    projectRows: allowedProjects,
    taskRows: rows.taskRows.filter(
      (task) => task.projectId !== null && allowedProjectIds.has(task.projectId),
    ),
    reportRows: rows.reportRows.filter((report) =>
      allowedProjectIds.has(report.projectId),
    ),
    settlementPoolRows: rows.settlementPoolRows.filter((item) =>
      allowedProjectIds.has(item.projectId),
    ),
    batchRows: rows.batchRows.filter((batch) =>
      allowedProjectIds.has(batch.projectId),
    ),
  };
}

function isProjectAssignedToUser(project: ProjectListItem, userId: string) {
  return (
    project.created_by === userId ||
    project.owner_id === userId ||
    project.ops_manager_id === userId
  );
}

function buildDashboardProjects(input: {
  projectRows: ProjectListItem[];
  projectCards: ProjectCardDto[];
  taskRows: OpsLiveTaskQueueItem[];
  reportRows: OpsLiveReportQueueItem[];
  settlementPoolRows: OpsSettlementPoolItem[];
  batchRows: OpsSettlementBatchListItem[];
  periodStart: string;
  periodEnd: string;
}): DashboardProjectInput[] {
  const projectRowsById = new Map(
    input.projectRows.map((project) => [project.id, project]),
  );
  const factsByProjectId = new Map(
    input.projectRows.map((project) => [project.id, createProjectFacts()]),
  );

  for (const task of input.taskRows) {
    const facts = task.projectId ? factsByProjectId.get(task.projectId) : null;
    if (!facts) continue;

    facts.plannedHours += minutesToHours(plannedTaskMinutes(task));
    facts.doneHours += minutesToHours(task.systemDuration);
    if (task.status === "abnormal") {
      facts.anomalies += 1;
    }
    addStreamer(facts, task.streamerId);
  }

  for (const report of input.reportRows) {
    const facts = factsByProjectId.get(report.projectId);
    const project = projectRowsById.get(report.projectId);
    if (!facts || !project) continue;

    const settlementHours = minutesToHours(report.settlementDuration ?? 0);
    if (isApprovedReportInPeriod(report, input.periodStart, input.periodEnd)) {
      facts.receivable += settlementHours * hourlyRateYuan(project);
    }
    facts.audience += report.viewers ?? 0;
    if (isPendingReportStatus(report.status)) {
      facts.reportedPending += 1;
    }
    addStreamer(facts, report.streamerId);
  }

  for (const item of input.settlementPoolRows) {
    const facts = factsByProjectId.get(item.projectId);
    if (!facts) continue;

    facts.payable += item.expectedAmount;
  }

  for (const batch of input.batchRows) {
    if (
      !isCountablePayableBatchInPeriod(
        batch,
        input.periodStart,
        input.periodEnd,
      )
    ) {
      continue;
    }
    const facts = factsByProjectId.get(batch.projectId);
    if (!facts) continue;

    facts.payable += batch.totalAmount;
  }

  return input.projectCards.map((card) => {
    const facts = factsByProjectId.get(card.id) ?? createProjectFacts();
    const receivable = roundCurrency(facts.receivable);
    const payable = roundCurrency(facts.payable);
    const gross = roundCurrency(receivable - payable);

    return {
      ...card,
      metrics: {
        ...card.metrics,
        plannedHours: roundHours(facts.plannedHours),
        doneHours: roundHours(facts.doneHours),
        audience: facts.audience,
        reportedPending: facts.reportedPending,
        anomalies: facts.anomalies,
        receivable,
        payable,
        gross,
        margin:
          receivable > 0 ? roundPercentage((gross / receivable) * 100) : 0,
      },
      streamers: {
        ...card.streamers,
        active: facts.streamerIds.size,
        candidate: hasStreamerGapProject(projectRowsById.get(card.id), facts)
          ? 1
          : 0,
        pendingReview: facts.reportedPending,
      },
    };
  });
}

function createProjectFacts() {
  return {
    plannedHours: 0,
    doneHours: 0,
    audience: 0,
    reportedPending: 0,
    anomalies: 0,
    receivable: 0,
    payable: 0,
    streamerIds: new Set<string>(),
  };
}

function plannedTaskMinutes(task: OpsLiveTaskQueueItem) {
  if (Number.isFinite(task.plannedDuration ?? Number.NaN)) {
    return Math.max(task.plannedDuration ?? 0, 0);
  }

  return minutesBetween(task.plannedStartAt, task.plannedEndAt);
}

function minutesBetween(start: string | null, end: string | null) {
  if (!start || !end) {
    return 0;
  }

  const started = new Date(start).getTime();
  const ended = new Date(end).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started) {
    return 0;
  }

  return Math.floor((ended - started) / 60_000);
}

function minutesToHours(minutes: number) {
  return Math.max(minutes, 0) / 60;
}

function hourlyRateYuan(project: ProjectListItem) {
  return Math.max(project.default_hourly_rate, 0) / 100;
}

function isPendingReportStatus(status: OpsLiveReportQueueItem["status"]) {
  return status === "pending_review" || status === "pending_adjudication";
}

function isApprovedReportInPeriod(
  report: OpsLiveReportQueueItem,
  periodStart: string,
  periodEnd: string,
) {
  return (
    report.status === "approved" &&
    isDateKeyInPeriod(report.submittedAt, periodStart, periodEnd)
  );
}

function isCountablePayableBatchInPeriod(
  batch: OpsSettlementBatchListItem,
  periodStart: string,
  periodEnd: string,
) {
  return (
    batch.batchType === "payable" &&
    batch.status !== "voided" &&
    batch.periodStart === periodStart &&
    batch.periodEnd === periodEnd
  );
}

function isDateKeyInPeriod(value: string, periodStart: string, periodEnd: string) {
  const dateKey = value.slice(0, 10);
  return dateKey >= periodStart && dateKey <= periodEnd;
}

function addStreamer(
  facts: ReturnType<typeof createProjectFacts>,
  streamerId: string | null,
) {
  if (streamerId) {
    facts.streamerIds.add(streamerId);
  }
}

function hasStreamerGapProject(
  project: ProjectListItem | undefined,
  facts: ReturnType<typeof createProjectFacts>,
) {
  if (!project) {
    return false;
  }

  return (
    ["active", "recruiting", "pending_start"].includes(project.status) &&
    facts.streamerIds.size === 0
  );
}

function roundHours(value: number) {
  return Math.round(value * 10) / 10;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function roundPercentage(value: number) {
  return Math.round(value * 10) / 10;
}

function toDashboardTask(
  task: Partial<OpsLiveTaskQueueItem>,
): DashboardTaskInput {
  return {
    id: task.id ?? "unknown-task",
    project: task.projectId ?? null,
    projectName: task.projectName ?? null,
    streamerName: task.streamerName ?? null,
    status: task.status ?? "unknown",
    plannedStartAt: task.plannedStartAt ?? null,
    plannedEndAt: task.plannedEndAt ?? null,
    anomaly: task.status === "abnormal",
  };
}

function toDashboardReport(
  report: Partial<OpsLiveReportQueueItem>,
): DashboardReportInput {
  return {
    id: report.id ?? "unknown-report",
    project: report.projectName ?? null,
    streamer: report.streamerName ?? null,
    status: report.status ?? "unknown",
    source: dashboardReportSource(report.timeSource),
    duration: report.settlementDuration ?? 0,
    audience: report.viewers ?? 0,
  };
}

function dashboardReportSource(
  timeSource: OpsLiveReportQueueItem["timeSource"] | undefined,
) {
  switch (timeSource) {
    case "system":
      return "system";
    case "screenshot":
      return "OCR";
    case "claimed":
      return "manual";
    default:
      return "unknown";
  }
}

function toDashboardSettlementPoolItem(
  item: Partial<OpsSettlementPoolItem>,
): DashboardSettlementPoolInput {
  return {
    id: item.id ?? "unknown-settlement-pool-item",
    projectName: item.projectName ?? null,
    streamerName: item.streamerName ?? null,
    expectedAmount: item.expectedAmount ?? 0,
    evidenceLevel: item.evidenceLevel ?? null,
    timeSource: item.timeSource ?? null,
  };
}

function toDashboardBatch(
  batch: Partial<OpsSettlementBatchListItem>,
): DashboardBatchInput {
  return {
    id: batch.id ?? "unknown-settlement-batch",
    status: batch.status ?? "unknown",
    projectName: batch.projectName ?? null,
    totalAmount: batch.totalAmount ?? 0,
    itemCount: batch.itemCount ?? 0,
  };
}
