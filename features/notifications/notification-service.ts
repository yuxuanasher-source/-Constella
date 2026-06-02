import { writeAuditLog } from "@/lib/audit/audit";
import type { AuthContext } from "@/lib/auth/context";

import type { NotificationStatus } from "./notification-center-queries";

export type NotificationAction = "read" | "handled" | "ignored";

type NotificationUpdateClient = {
  from(table: "notifications" | "audit_logs"): unknown;
};

const statusByAction: Record<NotificationAction, NotificationStatus> = {
  read: "read",
  handled: "handled",
  ignored: "ignored",
};

export async function updateNotificationStatus({
  client,
  auth,
  notificationId,
  action,
}: {
  client: NotificationUpdateClient;
  auth: Pick<AuthContext, "userId" | "organizationId" | "role" | "name">;
  notificationId: string;
  action: NotificationAction;
}) {
  const status = statusByAction[action];
  if (!status) {
    throw new Error("Unsupported notification action");
  }

  const notificationQuery = client.from("notifications") as {
    update(payload: Record<string, unknown>): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): {
          select(columns: string): {
            single(): PromiseLike<{
              data: { id: string; title: string; status: NotificationStatus };
              error: Error | null;
            }>;
          };
        };
      };
    };
  };

  const { data, error } = await notificationQuery
    .update({ status })
    .eq("id", notificationId)
    .eq("organization_id", auth.organizationId)
    .select("id,title,status")
    .single();

  if (error) {
    throw error;
  }

  await writeAuditLog(client as Parameters<typeof writeAuditLog>[0], {
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    actorName: auth.name,
    actorRole: auth.role,
    action: "update",
    module: "notification",
    objectType: "notification",
    objectId: notificationId,
    objectName: data.title,
    after: { status },
    changedFields: ["status"],
  });

  return data;
}
