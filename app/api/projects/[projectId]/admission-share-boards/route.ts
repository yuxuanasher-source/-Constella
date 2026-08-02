import { NextResponse } from "next/server";

import {
  AdmissionShareFormalRoundConflictError,
  AdmissionShareSelectionError,
  createAdmissionShareBoard,
  listInternalAdmissionShareBoards,
  SupabaseAdmissionShareBoardRepository,
  toAdmissionShareIdentityPresentation,
  type AdmissionShareBoardRecord,
  type AdmissionShareBoardTaskWithPresentation,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareCandidateRepository } from "@/features/applications/admission-share-candidates";
import {
  AdmissionShareProjectStatusError,
  assertCanCreateAdmissionShareForProject,
} from "@/features/applications/admission-share-policy";
import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  readJsonBody,
  RouteError,
} from "@/features/applications/application-route-utils";
import type {
  AdmissionShareMode,
  AdmissionShareSelectionInput,
} from "@/features/applications/admission-share-workflow";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { getPublicRequestOrigin } from "@/lib/http/public-request-origin";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const context = await getAdmissionRouteContext();
    assertMcnStaff(context.auth.role);

    const repo = new SupabaseAdmissionShareBoardRepository(context.supabase);
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const limit = admissionSharePageLimit(url.searchParams.get("limit"));
    const page = await listInternalAdmissionShareBoards({
      repo,
      actor: actorFromContext(context),
      projectId,
      cursor,
      limit,
    });

    return NextResponse.json({
      shareBoards: page.shareBoards.map(toSafeShareBoardTask),
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    return jsonError(error);
  }
}

function admissionSharePageLimit(value: string | null) {
  if (value === null) {
    return 20;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new RouteError(
      "Share board page limit must be between 1 and 50",
      400,
    );
  }
  return parsed;
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
    await assertCanCreateAdmissionShareForProject(context.supabase, {
      organizationId: context.auth.organizationId,
      projectId,
    });

    const repo = new SupabaseAdmissionShareBoardRepository(context.supabase);
    const admin = createSupabaseAdminClient();
    if (!admin) {
      throw new RouteError("Share candidate service is unavailable", 503);
    }
    const candidateRepo = new SupabaseAdmissionShareCandidateRepository(admin);
    const result = await createAdmissionShareBoard({
      repo,
      candidateRepo,
      audit: (input) => context.audit(context.supabase, input),
      actor: actorFromContext(context),
      projectId,
      input: {
        mode: admissionShareMode(body.mode),
        title: optionalString(body.title),
        purpose: optionalString(body.purpose),
        expiresAt: optionalString(body.expiresAt),
        requireAccessCode:
          typeof body.requireAccessCode === "boolean"
            ? body.requireAccessCode
            : undefined,
        accessCode: optionalString(body.accessCode),
        allowExternalFallback:
          typeof body.allowExternalFallback === "boolean"
            ? body.allowExternalFallback
            : undefined,
        contactCardId: admissionShareContactCardId(body.contactCardId),
        items: admissionShareSelectionItems(body.items),
      },
    });

    const shareUrl = new URL(
      `/share/admission/${result.token}`,
      getPublicRequestOrigin(request),
    );
    return NextResponse.json({
      shareBoard: {
        ...toSafeShareBoard(result.shareBoard),
        presentation: result.presentation,
      },
      shareUrl: shareUrl.toString(),
      accessCode: result.accessCode,
    });
  } catch (error) {
    if (error instanceof AdmissionShareProjectStatusError) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: error.statusCode },
      );
    }
    if (error instanceof AdmissionShareFormalRoundConflictError) {
      return NextResponse.json(
        {
          code: "SHARE_FORMAL_ROUND_CONFLICT",
          error: "当前已有进行中的正式复核，请先完成、撤销或等待过期。",
        },
        { status: 409 },
      );
    }
    if (error instanceof AdmissionShareSelectionError) {
      return NextResponse.json(
        {
          code: "SHARE_SELECTION_CHANGED",
          error: "部分录屏状态已变化，请移除异常项后重试。",
          items: error.items,
        },
        { status: 409 },
      );
    }
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
    purpose: shareBoard.purpose,
    mode: shareBoard.mode,
    status: shareBoard.status,
    expiresAt: shareBoard.expiresAt,
    allowVendorSubmit: shareBoard.allowVendorSubmit,
    allowExternalFallback: shareBoard.allowExternalFallback,
    reviewState: shareBoard.reviewState,
    roundNumber: shareBoard.roundNumber,
    brandVersion: shareBoard.brandVersion,
    contactCardId: shareBoard.contactCardId,
    ...toAdmissionShareIdentityPresentation(shareBoard),
    createdBy: shareBoard.createdBy,
    createdAt: shareBoard.createdAt,
  };
}

function toSafeShareBoardTask(
  shareBoard: AdmissionShareBoardTaskWithPresentation,
) {
  return {
    id: shareBoard.id,
    title: shareBoard.title,
    purpose: shareBoard.purpose,
    mode: shareBoard.mode,
    status: shareBoard.status,
    reviewState: shareBoard.reviewState,
    roundNumber: shareBoard.roundNumber,
    expiresAt: shareBoard.expiresAt,
    itemCount: shareBoard.itemCount,
    draftCompletedCount: shareBoard.draftCompletedCount,
    lastViewedAt: shareBoard.lastViewedAt,
    lastDraftAt: shareBoard.lastDraftAt,
    lastSubmittedAt: shareBoard.lastSubmittedAt,
    lockedAt: shareBoard.lockedAt,
    createdBy: shareBoard.createdBy,
    createdAt: shareBoard.createdAt,
    presentation: shareBoard.presentation,
  };
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function admissionShareContactCardId(
  value: unknown,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new RouteError("contactCardId must be a UUID or null", 400);
  }
  return value.trim();
}

function admissionShareMode(value: unknown): AdmissionShareMode {
  if (value === "preview" || value === "formal_review") {
    return value;
  }
  throw new RouteError("mode must be preview or formal_review", 400);
}

function admissionShareSelectionItems(
  value: unknown,
): AdmissionShareSelectionInput[] {
  if (!Array.isArray(value)) {
    throw new RouteError("items must be an array", 400);
  }

  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new RouteError("Each share item must be an object", 400);
    }
    const record = item as Record<string, unknown>;
    const applicationId = optionalString(record.applicationId);
    const recordingSubmissionId = optionalString(record.recordingSubmissionId);
    const recordingVersion = record.recordingVersion;
    const sortOrder = record.sortOrder;
    if (
      !applicationId ||
      !recordingSubmissionId ||
      !Number.isInteger(recordingVersion) ||
      Number(recordingVersion) <= 0 ||
      !Number.isInteger(sortOrder) ||
      Number(sortOrder) < 0
    ) {
      throw new RouteError("Invalid admission share item", 400);
    }

    return {
      applicationId,
      recordingSubmissionId,
      recordingVersion: Number(recordingVersion),
      sortOrder: Number(sortOrder),
    };
  });
}
