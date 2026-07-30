import { NextResponse } from "next/server";

import {
  reopenAdmissionShareBoard,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  readJsonBody,
  RouteError,
} from "@/features/applications/application-route-utils";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; shareBoardId: string }> },
) {
  try {
    const { projectId, shareBoardId } = await params;
    const context = await getAdmissionRouteContext();
    assertMcnStaff(context.auth.role);
    const body = await readJsonBody(request);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      throw new RouteError("reason is required", 400);
    }

    const repo = new SupabaseAdmissionShareBoardRepository(context.supabase);
    await reopenAdmissionShareBoard({
      repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: actorFromContext(context),
      projectId,
      shareBoardId,
      reason,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return lifecycleJsonError(error);
  }
}

function assertMcnStaff(role: Parameters<typeof isMcnStaff>[0]) {
  if (!isMcnStaff(role)) {
    throw new RouteError(
      "Only MCN staff can reopen admission share boards",
      403,
    );
  }
}

function lifecycleJsonError(error: unknown) {
  const status =
    error && typeof error === "object" && "statusCode" in error
      ? Number(error.statusCode)
      : null;
  return status && status >= 400 && status <= 499
    ? NextResponse.json(
        { error: error instanceof Error ? error.message : "Request failed" },
        { status },
      )
    : jsonError(error);
}
