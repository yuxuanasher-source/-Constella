import { NextResponse } from "next/server";

import {
  createAdmissionShareBoard,
  listAdmissionShareBoards,
  SupabaseAdmissionShareBoardRepository,
  type AdmissionShareBoardRecord,
} from "@/features/applications/admission-share-board";
import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  readJsonBody,
  RouteError,
} from "@/features/applications/application-route-utils";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const context = await getAdmissionRouteContext();
    assertMcnStaff(context.auth.role);

    const repo = new SupabaseAdmissionShareBoardRepository(context.supabase);
    const shareBoards = await listAdmissionShareBoards({
      repo,
      actor: actorFromContext(context),
      projectId,
    });

    return NextResponse.json({
      shareBoards: shareBoards.map(toSafeShareBoard),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const body = await readJsonBody(request);
    const context = await getAdmissionRouteContext();
    assertMcnStaff(context.auth.role);

    const repo = new SupabaseAdmissionShareBoardRepository(context.supabase);
    const result = await createAdmissionShareBoard({
      repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: actorFromContext(context),
      projectId,
      input: {
        title: optionalString(body.title),
        expiresAt: optionalString(body.expiresAt),
        accessCode: optionalString(body.accessCode),
        applicationIds: arrayOfStrings(body.applicationIds),
        allowVendorSubmit:
          typeof body.allowVendorSubmit === "boolean"
            ? body.allowVendorSubmit
            : undefined,
      },
    });

    const shareUrl = new URL(`/share/admission/${result.token}`, request.url);
    return NextResponse.json({
      shareBoard: toSafeShareBoard(result.shareBoard),
      shareUrl: shareUrl.toString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

function assertMcnStaff(role: Parameters<typeof isMcnStaff>[0]) {
  if (!isMcnStaff(role)) {
    throw new RouteError(
      "Only MCN staff can manage admission share boards",
      403,
    );
  }
}

function toSafeShareBoard(shareBoard: AdmissionShareBoardRecord) {
  return {
    id: shareBoard.id,
    organizationId: shareBoard.organizationId,
    projectId: shareBoard.projectId,
    title: shareBoard.title,
    status: shareBoard.status,
    expiresAt: shareBoard.expiresAt,
    allowVendorSubmit: shareBoard.allowVendorSubmit,
    createdBy: shareBoard.createdBy,
    createdAt: shareBoard.createdAt,
  };
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}
