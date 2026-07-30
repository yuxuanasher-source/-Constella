import { NextResponse } from "next/server";

import {
  rotateAdmissionShareBoardToken,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
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

    const repo = new SupabaseAdmissionShareBoardRepository(context.supabase);
    const result = await rotateAdmissionShareBoardToken({
      repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: actorFromContext(context),
      projectId,
      shareBoardId,
    });

    const shareUrl = new URL(
      `/share/admission/${result.token}`,
      process.env.NEXT_PUBLIC_APP_URL ?? request.url,
    );
    return NextResponse.json({ shareUrl: shareUrl.toString() });
  } catch (error) {
    return lifecycleJsonError(error);
  }
}

function assertMcnStaff(role: Parameters<typeof isMcnStaff>[0]) {
  if (!isMcnStaff(role)) {
    throw new RouteError(
      "Only MCN staff can rotate admission share tokens",
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
