import { NextResponse } from "next/server";

import {
  listNotificationCenterItems,
  type NotificationQueryClient,
  type NotificationStatus,
} from "@/features/notifications/notification-center-queries";
import { withAuth } from "@/lib/http/route-handler";

export const GET = withAuth(async ({ supabase, auth, request }) => {
  const params = new URL(request.url).searchParams;
  const items = await listNotificationCenterItems(
    supabase as unknown as NotificationQueryClient,
    {
      userId: auth.userId,
      role: auth.role,
      organizationId: auth.organizationId,
    },
    {
      status: parseStatus(params.get("status")),
    },
  );

  return NextResponse.json({
    items,
    unreadCount: items.filter((item) => item.status === "unread").length,
  });
});

function parseStatus(value: string | null): NotificationStatus | undefined {
  if (
    value === "unread" ||
    value === "read" ||
    value === "handled" ||
    value === "ignored"
  ) {
    return value;
  }

  return undefined;
}
