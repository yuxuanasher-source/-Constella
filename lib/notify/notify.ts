import type { AppRole } from "@/lib/rbac/roles";

export type NotificationType =
  | "task"
  | "review"
  | "anomaly"
  | "settlement"
  | "system"
  | "high_risk";

type NotificationInsertClient = {
  from(table: "notifications"): {
    insert(
      payload: Record<string, unknown>,
    ): PromiseLike<{ error: Error | null }>;
  };
};

export type NotificationInput = {
  organizationId: string;
  recipientUserId?: string;
  recipientRole?: AppRole;
  type: NotificationType;
  title: string;
  content: string;
  objectType?: string;
  objectId?: string;
  source?: string;
  isHighRisk?: boolean;
};

export async function sendNotification(
  client: NotificationInsertClient,
  input: NotificationInput,
): Promise<void> {
  if (!input.recipientUserId && !input.recipientRole) {
    throw new Error("Notification requires a recipient user or role");
  }

  const { error } = await client.from("notifications").insert({
    organization_id: input.organizationId,
    recipient_user_id: input.recipientUserId,
    recipient_role: input.recipientRole,
    notification_type: input.type,
    status: "unread",
    title: input.title,
    content: input.content,
    object_type: input.objectType,
    object_id: input.objectId,
    source: input.source,
    is_high_risk: input.isHighRisk ?? false,
  });

  if (error) {
    throw error;
  }
}
