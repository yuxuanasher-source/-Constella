import { NextResponse } from "next/server";

import {
  listNotificationCenterItems,
  type NotificationQueryClient,
  type NotificationStatus,
} from "@/features/notifications/notification-center-queries";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: statusForServiceError(error) },
      );
    }

    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

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
