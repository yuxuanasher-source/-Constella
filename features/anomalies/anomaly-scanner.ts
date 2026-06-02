import { writeAuditLog } from "@/lib/audit/audit";
import type { AuthContext } from "@/lib/auth/context";
import { sendNotification } from "@/lib/notify/notify";

import {
  detectTaskAnomalies,
  type AnomalyTaskSnapshot,
  type DetectedAnomaly,
} from "./anomaly-rules";

type AnomalyScanClient = {
  from(table: string): unknown;
};

type LiveTaskAnomalyRow = AnomalyTaskSnapshot & {
  organization_id: string;
  project_id: string | null;
  title: string;
  live_reports?: Array<{
    id: string;
    report_screenshots?: Array<{ id: string }> | null;
  }> | null;
};

export async function scanLiveOperationAnomalies({
  client,
  actor,
  now = new Date().toISOString(),
}: {
  client: AnomalyScanClient;
  actor: Pick<AuthContext, "userId" | "role" | "name" | "organizationId">;
  now?: string;
}) {
  const rows = await listTaskRows(client, actor.organizationId);
  const anomalies = rows.flatMap((row) =>
    detectTaskAnomalies({ now, task: normalizeTaskRow(row) }).map(
      (anomaly) => ({ row, anomaly }),
    ),
  );

  let sentCount = 0;
  for (const { row, anomaly } of anomalies) {
    const source = anomalySource(anomaly);
    if (await notificationExists(client, actor.organizationId, source)) {
      continue;
    }

    await sendNotification(client as Parameters<typeof sendNotification>[0], {
      organizationId: actor.organizationId,
      recipientRole: "ops_manager",
      type: "anomaly",
      title: anomalyTitle(anomaly),
      content: `${row.title} 出现异常：${anomaly.type}`,
      objectType: anomaly.objectType,
      objectId: anomaly.objectId,
      source,
      isHighRisk: anomaly.severity === "danger",
    });
    sentCount += 1;
  }

  await writeAuditLog(client as Parameters<typeof writeAuditLog>[0], {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "anomaly",
    objectType: "anomaly_scan",
    after: {
      detectedCount: anomalies.length,
      sentCount,
    },
    changedFields: ["notifications"],
  });

  return {
    detectedCount: anomalies.length,
    sentCount,
  };
}

async function listTaskRows(
  client: AnomalyScanClient,
  organizationId: string,
): Promise<LiveTaskAnomalyRow[]> {
  const query = client.from("live_tasks") as {
    select(columns: string): {
      eq(column: string, value: unknown): {
        order(column: string, options: { ascending: boolean }): {
          limit(count: number): PromiseLike<{
            data: LiveTaskAnomalyRow[] | null;
            error: Error | null;
          }>;
        };
      };
    };
  };

  const { data, error } = await query
    .select(
      "id, organization_id, project_id, status, title, planned_start_at, planned_end_at, system_started_at, system_stopped_at, live_reports(id, report_screenshots(id))",
    )
    .eq("organization_id", organizationId)
    .order("planned_start_at", { ascending: true })
    .limit(200);

  if (error) {
    throw error;
  }

  return data ?? [];
}

function normalizeTaskRow(row: LiveTaskAnomalyRow): AnomalyTaskSnapshot {
  const reports = row.live_reports ?? [];
  return {
    id: row.id,
    status: row.status,
    planned_start_at: row.planned_start_at,
    planned_end_at: row.planned_end_at,
    system_started_at: row.system_started_at,
    system_stopped_at: row.system_stopped_at,
    has_report: row.has_report ?? reports.length > 0,
    has_checkout_screenshot:
      row.has_checkout_screenshot ??
      reports.some((report) => (report.report_screenshots ?? []).length > 0),
  };
}

async function notificationExists(
  client: AnomalyScanClient,
  organizationId: string,
  source: string,
): Promise<boolean> {
  const query = client.from("notifications") as {
    select(columns: string): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): {
          maybeSingle(): PromiseLike<{
            data: { id: string } | null;
            error: Error | null;
          }>;
        };
      };
    };
  };

  const { data, error } = await query
    .select("id")
    .eq("organization_id", organizationId)
    .eq("source", source)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

function anomalySource(anomaly: DetectedAnomaly): string {
  return `anomaly:${anomaly.type}:${anomaly.objectId}`;
}

function anomalyTitle(anomaly: DetectedAnomaly): string {
  const labels: Record<string, string> = {
    not_started: "直播任务未开播",
    not_reported: "直播任务未报数",
    report_overdue: "报数已逾期",
    missing_checkout_screenshot: "缺少下播截图",
    live_over_48h: "直播超过 48 小时",
  };
  return labels[anomaly.type] ?? "直播任务异常";
}
