import type { AppRole } from "@/lib/rbac/roles";

export type NotificationStatus = "unread" | "read" | "handled" | "ignored";

export type NotificationCenterActor = {
  userId: string;
  role: AppRole;
  organizationId: string;
};

export type NotificationCenterFilters = {
  status?: NotificationStatus;
  limit?: number;
};

export type NotificationCenterRow = {
  id: string;
  notification_type: string;
  status: NotificationStatus;
  title: string;
  content: string;
  object_type: string | null;
  object_id: string | null;
  is_high_risk: boolean;
  created_at: string;
};

export type NotificationCenterItem = {
  id: string;
  type: string;
  status: NotificationStatus;
  title: string;
  content: string;
  objectType: string | null;
  objectId: string | null;
  isHighRisk: boolean;
  createdAt: string;
};

export type NotificationQueryClient = {
  from(table: "notifications"): {
    select(
      columns: string,
      options?: { count?: "exact"; head?: boolean },
    ): NotificationQueryBuilder;
  };
};

type NotificationQueryBuilder = {
  eq(column: string, value: unknown): NotificationQueryBuilder;
  or(filter: string): NotificationQueryBuilder;
  order(
    column: string,
    options: { ascending: boolean },
  ): NotificationQueryBuilder;
  limit(count: number): PromiseLike<{
    data: unknown[] | null;
    count?: number | null;
    error: { message: string } | null;
  }>;
};

const notificationCenterSelect = `
  id,
  notification_type,
  status,
  title,
  content,
  object_type,
  object_id,
  is_high_risk,
  created_at
`;

export async function listNotificationCenterItems(
  client: NotificationQueryClient,
  actor: NotificationCenterActor,
  filters: NotificationCenterFilters = {},
): Promise<NotificationCenterItem[]> {
  let query = scopeNotificationQuery(
    client.from("notifications").select(notificationCenterSelect),
    actor,
  );

  if (filters.status) {
    query = query.eq("status", filters.status);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(safeLimit(filters.limit));

  if (error) {
    throw error;
  }

  return ((data ?? []) as NotificationCenterRow[]).map(
    toNotificationCenterItem,
  );
}

export async function countUnreadNotificationCenterItems(
  client: NotificationQueryClient,
  actor: NotificationCenterActor,
): Promise<number> {
  const { count, error } = await scopeNotificationQuery(
    client.from("notifications").select("id", { count: "exact", head: true }),
    actor,
  )
    .eq("status", "unread")
    .limit(1);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

export function toNotificationCenterItem(
  row: NotificationCenterRow,
): NotificationCenterItem {
  return {
    id: row.id,
    type: row.notification_type,
    status: row.status,
    title: row.title,
    content: row.content,
    objectType: row.object_type,
    objectId: row.object_id,
    isHighRisk: row.is_high_risk,
    createdAt: row.created_at,
  };
}

function safeLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) {
    return 50;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

function scopeNotificationQuery(
  query: NotificationQueryBuilder,
  actor: NotificationCenterActor,
): NotificationQueryBuilder {
  return query
    .eq("organization_id", actor.organizationId)
    .or(`recipient_user_id.eq.${actor.userId},recipient_role.eq.${actor.role}`);
}
