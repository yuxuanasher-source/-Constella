import { NextResponse } from "next/server";

import {
  updateNotificationStatus,
  type NotificationAction,
} from "@/features/notifications/notification-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ notificationId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const action = parseAction(body?.action);
    if (!action) {
      return NextResponse.json(
        { error: "Unsupported notification action" },
        { status: 400 },
      );
    }

    const { notificationId } = await context.params;
    const notification = await updateNotificationStatus({
      client: supabase,
      auth,
      notificationId,
      action,
    });

    return NextResponse.json({ notification });
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

function parseAction(value: unknown): NotificationAction | null {
  if (value === "read" || value === "handled" || value === "ignored") {
    return value;
  }

  return null;
}
