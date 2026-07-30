import { NextResponse } from "next/server";

import {
  listAdmissionShareCandidates,
  SupabaseAdmissionShareCandidateRepository,
} from "@/features/applications/admission-share-candidates";
import {
  AdmissionShareProjectStatusError,
  assertCanCreateAdmissionShareForProject,
} from "@/features/applications/admission-share-policy";
import {
  preflightAdmissionShareSelection,
  type AdmissionShareSelectionInput,
} from "@/features/applications/admission-share-workflow";
import {
  getAdmissionRouteContext,
  jsonError,
  readJsonBody,
  RouteError,
} from "@/features/applications/application-route-utils";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const context = await getAdmissionRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError(
        "Only MCN staff can preflight share candidates",
        403,
      );
    }

    const body = await readJsonBody(request);
    const items = parseSelectionItems(body.items);
    await assertCanCreateAdmissionShareForProject(context.supabase, {
      organizationId: context.auth.organizationId,
      projectId,
    });
    const admin = createSupabaseAdminClient();
    if (!admin) {
      throw new RouteError("Share candidate service is unavailable", 503);
    }
    const repo = new SupabaseAdmissionShareCandidateRepository(admin);
    const candidates = await listAdmissionShareCandidates(repo, {
      organizationId: context.auth.organizationId,
      projectId,
    });

    return NextResponse.json(
      preflightAdmissionShareSelection(candidates, items),
    );
  } catch (error) {
    if (error instanceof AdmissionShareProjectStatusError) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: error.statusCode },
      );
    }
    return jsonError(error);
  }
}

function parseSelectionItems(value: unknown): AdmissionShareSelectionInput[] {
  if (!Array.isArray(value)) {
    throw new RouteError("items must be an array", 400);
  }

  return value.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      !isNonEmptyString(item.applicationId) ||
      !isNonEmptyString(item.recordingSubmissionId) ||
      !Number.isInteger(item.recordingVersion) ||
      Number(item.recordingVersion) <= 0 ||
      !Number.isInteger(item.sortOrder) ||
      Number(item.sortOrder) < 0
    ) {
      throw new RouteError("Invalid admission share selection", 400);
    }

    return {
      applicationId: item.applicationId.trim(),
      recordingSubmissionId: item.recordingSubmissionId.trim(),
      recordingVersion: Number(item.recordingVersion),
      sortOrder: Number(item.sortOrder),
    };
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}
