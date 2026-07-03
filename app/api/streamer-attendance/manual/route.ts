import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  actorFromContext,
  getStreamerLifecycleRouteContext,
  jsonError,
  optionalNumber,
  optionalString,
  readJsonBody,
  requiredString,
  RouteError,
} from "@/features/streamer-lifecycle/streamer-lifecycle-route-utils";
import { recordManualAttendance } from "@/features/streamer-lifecycle/streamer-lifecycle-service";
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
} from "@/features/streamer-lifecycle/streamer-lifecycle-state";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const liveTaskId = requiredString(body, "liveTaskId");
    const attendanceStatus = requiredString(body, "attendanceStatus");
    if (!ATTENDANCE_STATUSES.includes(attendanceStatus as AttendanceStatus)) {
      throw new RouteError(
        `attendanceStatus must be one of ${ATTENDANCE_STATUSES.join(", ")}`,
        400,
      );
    }
    const reason = requiredString(body, "reason");

    const context = await getStreamerLifecycleRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "project_management",
    });

    await recordManualAttendance({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: await actorFromContext(context),
      input: {
        liveTaskId,
        attendanceStatus: attendanceStatus as AttendanceStatus,
        lateMinutes: optionalNumber(body, "lateMinutes"),
        note: optionalString(body, "note"),
      },
      reason,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
