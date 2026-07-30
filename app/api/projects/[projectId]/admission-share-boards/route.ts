import { NextResponse } from "next/server";

import {
  AdmissionShareFormalRoundConflictError,
  AdmissionShareSelectionError,
  createAdmissionShareBoard,
  listAdmissionShareBoards,
  SupabaseAdmissionShareBoardRepository,
  type AdmissionShareBoardRecord,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareCandidateRepository } from "@/features/applications/admission-share-candidates";
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
        items: admissionShareSelectionItems(body.items),
      },
    });

    // Build the public link from the configured app URL so it works for
    // external visitors; fall back to the request origin in local/dev.
    const shareUrl = new URL(
      `/share/admission/${result.token}`,
      process.env.NEXT_PUBLIC_APP_URL ?? request.url,
    );
    return NextResponse.json({
      shareBoard: toSafeShareBoard(result.shareBoard),
      shareUrl: shareUrl.toString(),
      accessCode: result.accessCode,
    });
  } catch (error) {
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
    createdBy: shareBoard.createdBy,
    createdAt: shareBoard.createdAt,
  };
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
