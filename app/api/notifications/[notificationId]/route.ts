import { NextResponse } from "next/server";

import {
  updateNotificationStatus,
  type NotificationAction,
} from "@/features/notifications/notification-service";
import { withAuth } from "@/lib/http/route-handler";

export const PATCH = withAuth<{ notificationId: string }>(
  async ({ supabase, auth, request, params }) => {
    const body = await request.json();
    const action = parseAction(body?.action);
    if (!action) {
      return NextResponse.json(
        { error: "Unsupported notification action" },
        { status: 400 },
      );
    }

    const { notificationId } = params;
    const notification = await updateNotificationStatus({
      client: supabase,
      auth,
      notificationId,
      action,
    });

    return NextResponse.json({ notification });
  },
);

function parseAction(value: unknown): NotificationAction | null {
  if (value === "read" || value === "handled" || value === "ignored") {
    return value;
  }

  return null;
}
