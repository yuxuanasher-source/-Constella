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
import { listProjects } from "@/features/projects/project-queries";
import { toProjectCardDtos } from "@/features/projects/project-ui-dto";
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

  return buildRoleHomeDashboard({
    role,
    userId: input.auth.userId,
    organizationId,
    source: {
      now,
      projects: toProjectCardDtos(projectRows),
      tasks: taskRows.map(toDashboardTask),
      reports: reportRows.map(toDashboardReport),
      settlementPool: settlementPoolRows.map(toDashboardSettlementPoolItem),
      batches: batchRows.map(toDashboardBatch),
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
