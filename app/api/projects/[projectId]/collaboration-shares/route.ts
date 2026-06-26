import { NextResponse } from "next/server";

import {
  createProjectCollaborationShare,
  listProjectCollaborationShares,
  SupabaseProjectCollaborationRepository,
  type CollaborationShareRecord,
} from "@/features/collaborations/project-collaboration-service";
import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  readJsonBody,
} from "@/features/applications/application-route-utils";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const context = await getAdmissionRouteContext();
    const repo = new SupabaseProjectCollaborationRepository(context.supabase);
    const shares = await listProjectCollaborationShares({
      repo,
      actor: actorFromContext(context),
      projectId,
    });

    return NextResponse.json({ shares: shares.map(toSafeShare) });
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
    const repo = new SupabaseProjectCollaborationRepository(context.supabase);
    const result = await createProjectCollaborationShare({
      repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: actorFromContext(context),
      projectId,
      input: {
        expiresAt: optionalString(body.expiresAt),
        allowApplications:
          typeof body.allowApplications === "boolean"
            ? body.allowApplications
            : undefined,
        visibleFields: arrayOfStrings(body.visibleFields),
      },
    });

    const shareUrl = new URL(
      `/share/project-collaboration/${result.token}`,
      request.url,
    );

    return NextResponse.json({
      share: toSafeShare(result.share),
      shareUrl: shareUrl.toString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

function toSafeShare(share: CollaborationShareRecord) {
  return {
    id: share.id,
    ownerOrganizationId: share.ownerOrganizationId,
    projectId: share.projectId,
    status: share.status,
    expiresAt: share.expiresAt,
    allowApplications: share.allowApplications,
    visibleFields: share.visibleFields,
    createdBy: share.createdBy,
    createdAt: share.createdAt,
    revokedBy: share.revokedBy,
    revokedAt: share.revokedAt,
    lastViewedAt: share.lastViewedAt,
    lastSubmittedAt: share.lastSubmittedAt,
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
